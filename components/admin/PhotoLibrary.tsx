"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Field, Segmented, SelectField, TextField, Toggle } from "./fields";
import { Icon } from "./Icon";
import { Card, Empty, Loading, PageHead, Sheet } from "./ui";
import { formatShortDate, todayIso } from "@/lib/admin/dates";
import { PHOTO_ACCEPT, photoKind, preparePhoto } from "@/lib/admin/photo-prepare";
import { categoryLabel, formatBytes, MAX_ALT_LENGTH, MAX_TITLE_LENGTH, nameFromSlug, PHOTO_CATEGORIES, photoDetails, photoSlug } from "@/lib/photos";
import type { Photo, PhotoCategory } from "@/lib/photos";

type Upload = { key: string; file: File; preview: string; title: string; altText: string; state: "waiting" | "preparing" | "uploading" | "done" | "failed"; error: string };
type Problem = { message: string; setup: boolean };

const categoryOptions = PHOTO_CATEGORIES.map(([value, label]) => [value, label] as [PhotoCategory, string]);
const UNREACHABLE = "Your photos could not be loaded. Check your connection and try again.";
const ALT_HINT = "Say what the photo shows, e.g. “Freshly painted hallway with white woodwork”. Google and screen readers use this.";

async function errorMessage(response: Response, fallback: string) {
  const body: unknown = await response.json().catch(() => null);
  return body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : fallback;
}

/** Copies on the first tap; where the clipboard is unavailable the address is shown to copy by hand. */
function CopyButton({ url, label = "Copy URL", className = "adm-btn adm-btn-small" }: { url: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2500);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      window.prompt("Copy this photo address:", url);
    }
  };
  return (
    <button type="button" className={className} onClick={() => void copy()} aria-live="polite">
      <Icon name={copied ? "check" : "copy"} size={16} /> {copied ? "Copied" : label}
    </button>
  );
}

function PhotoCard({ photo, onEdit }: { photo: Photo; onEdit: () => void }) {
  const titleId = useId();
  return (
    <article className="adm-photo" aria-labelledby={titleId}>
      {/* A larger tap target for touch; the Edit button below is the accessible control. */}
      <button type="button" className="adm-photo-thumb" onClick={onEdit} tabIndex={-1} aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element -- already resized WebP from Storage; next/image would re-encode it */}
        <img src={photo.thumbUrl} alt="" width={photo.thumbWidth} height={photo.thumbHeight} loading="lazy" decoding="async" />
      </button>
      <div className="adm-photo-body">
        <strong id={titleId}>{photo.title}</strong>
        <span>{categoryLabel(photo.category)}</span>
      </div>
      <div className="adm-photo-actions">
        <CopyButton url={photo.url} />
        <button type="button" className="adm-icon-btn" onClick={onEdit} aria-label={`Edit ${photo.title}`}>
          <Icon name="edit" />
        </button>
      </div>
    </article>
  );
}

function EditPhoto({ photo, onClose, onSaved, onDeleted }: {
  photo: Photo;
  onClose: () => void;
  onSaved: (photo: Photo, moved: boolean) => void;
  onDeleted: (id: string) => void;
}) {
  const [title, setTitle] = useState(photo.title);
  const [altText, setAltText] = useState(photo.altText);
  const [category, setCategory] = useState<PhotoCategory>(photo.category);
  const [renameFile, setRenameFile] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const addressChanges = !nameFromSlug(photo.fileName, photoSlug(title));

  async function send(method: "PATCH" | "DELETE") {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/photos/${photo.id}`, {
        method, credentials: "same-origin",
        ...(method === "PATCH" ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, altText, category, renameFile: renameFile && addressChanges }) } : {}),
      });
      if (response.status === 401) { window.location.assign("/login"); return; }
      if (!response.ok) throw new Error(await errorMessage(response, "The photo could not be changed. Please try again."));
      if (method === "DELETE") onDeleted(photo.id);
      else {
        const saved = (await response.json()).photo as Photo;
        onSaved(saved, saved.url !== photo.url);
      }
    } catch (failure) {
      setError(failure instanceof Error && failure.message !== "Failed to fetch" ? failure.message : "The photo could not be changed. Check your connection and try again.");
      setBusy(false);
    }
  }

  const save = () => {
    const checked = photoDetails({ title, altText, category });
    if (!checked.ok) { setError(checked.error); return; }
    void send("PATCH");
  };
  const remove = () => {
    if (window.confirm(`Delete “${photo.title}”? It will disappear from any web page that uses it. This cannot be undone.`)) void send("DELETE");
  };

  return (
    <Sheet
      open
      onClose={() => { if (!busy) onClose(); }}
      title="Photo details"
      actions={<>
        <button type="button" className="adm-btn adm-btn-danger" disabled={busy} onClick={remove}><Icon name="trash" size={16} /> Delete</button>
        <button type="button" className="adm-btn adm-btn-wide" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save changes"}</button>
      </>}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- already resized WebP from Storage; next/image would re-encode it */}
      <img
        className="adm-photo-large"
        src={photo.url}
        srcSet={`${photo.thumbUrl} ${photo.thumbWidth}w, ${photo.url} ${photo.width}w`}
        sizes="(min-width: 640px) 520px, 100vw"
        width={photo.width}
        height={photo.height}
        alt={photo.altText || photo.title}
      />
      <p className="adm-muted adm-small">
        {photo.width} × {photo.height} px · {formatBytes(photo.bytes)} WebP · added {formatShortDate(todayIso(new Date(photo.createdAt)))}
      </p>
      <div className="adm-photo-address">
        <Field label="Web address">
          {control => <input {...control} className="adm-input" value={photo.url} readOnly onFocus={event => event.target.select()} />}
        </Field>
        <div className="adm-actions">
          <CopyButton url={photo.url} />
          <CopyButton url={photo.thumbUrl} label="Copy thumbnail URL" className="adm-btn adm-btn-ghost adm-btn-small" />
          <a className="adm-btn adm-btn-ghost adm-btn-small" href={photo.url} target="_blank" rel="noopener noreferrer">Open</a>
        </div>
      </div>
      <TextField label="Title" value={title} onChange={setTitle} maxLength={MAX_TITLE_LENGTH} autoComplete="off" />
      <Field label="Description for Google" hint={ALT_HINT}>
        {control => <textarea {...control} className="adm-input adm-textarea" rows={2} maxLength={MAX_ALT_LENGTH} value={altText} onChange={event => setAltText(event.target.value)} />}
      </Field>
      <SelectField label="Category" value={category} options={categoryOptions} onChange={setCategory} />
      {addressChanges && (
        <Toggle
          label="Also change the web address"
          hint="Gives the photo a file name from the new title. Only do this if the photo is not on the website yet: the old address will stop working."
          checked={renameFile}
          onChange={setRenameFile}
        />
      )}
      {error && <p className="adm-inline-error" role="alert">{error}</p>}
    </Sheet>
  );
}

const stateLabels: Record<Upload["state"], string> = {
  waiting: "",
  preparing: "Preparing…",
  uploading: "Uploading…",
  done: "Uploaded",
  failed: "",
};

/** Admin → Photos: upload from a phone or computer, copy web addresses, rename, categorise and delete. */
export function PhotoLibrary() {
  const [photos, setPhotos] = useState<Photo[] | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [filter, setFilter] = useState<"all" | PhotoCategory>("all");
  const [query, setQuery] = useState("");
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [category, setCategory] = useState<PhotoCategory>("other");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Photo | null>(null);
  const [notice, setNotice] = useState("");
  const picker = useRef<HTMLInputElement>(null);
  const counter = useRef(0);

  const load = useCallback(async (signal?: AbortSignal, attempt = 1): Promise<void> => {
    setProblem(null);
    try {
      const response = await fetch("/api/admin/photos", { credentials: "same-origin", cache: "no-store", signal });
      if (response.status === 401) { window.location.assign("/login"); return; }
      const body: unknown = await response.json().catch(() => null);
      const result = body && typeof body === "object" ? body as { photos?: unknown; error?: unknown; setup?: unknown } : {};
      if (response.ok && Array.isArray(result.photos)) { setPhotos(result.photos as Photo[]); return; }
      // A brief upstream stall answers 503; try again by itself before asking Mike to.
      if (response.status === 503 && result.setup !== true && attempt < 3) {
        await new Promise(resolve => setTimeout(resolve, 3000 * attempt));
        if (!signal?.aborted) return load(signal, attempt + 1);
        return;
      }
      setProblem({ message: typeof result.error === "string" ? result.error : UNREACHABLE, setup: result.setup === true });
    } catch {
      if (!signal?.aborted) setProblem({ message: UNREACHABLE, setup: false });
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const choose = (files: FileList | null) => {
    if (!files?.length) return;
    setNotice("");
    const added = Array.from(files).slice(0, 20).map(file => ({
      key: `upload-${(counter.current += 1)}`, file, preview: URL.createObjectURL(file), title: "", altText: "", state: "waiting" as const,
      error: photoKind(file) ? "" : "Please choose a JPG, PNG, WEBP or HEIC photo.",
    }));
    setUploads(current => [...current.filter(item => item.state !== "done"), ...added]);
  };

  const closeUploads = () => {
    if (busy) return;
    for (const item of uploads) URL.revokeObjectURL(item.preview);
    setUploads([]);
  };

  const change = (key: string, patch: Partial<Upload>) => setUploads(current => current.map(item => item.key === key ? { ...item, ...patch } : item));

  async function uploadAll() {
    // Check every photo first, so a missing title never leaves a batch half uploaded.
    let invalid = false;
    const checked = uploads.map(item => {
      if (item.state === "done") return item;
      const details = photoDetails({ title: item.title, altText: item.altText, category });
      const error = !photoKind(item.file) ? "Please choose a JPG, PNG, WEBP or HEIC photo, or remove this one." : details.ok ? "" : details.error;
      if (error) invalid = true;
      return { ...item, state: error ? "failed" as const : "waiting" as const, error };
    });
    setUploads(checked);
    if (invalid) return;
    setBusy(true);
    let uploaded = 0;
    let failed = 0;
    // One at a time keeps a phone's memory and mobile data steady.
    for (const item of checked) {
      if (item.state === "done") continue;
      try {
        change(item.key, { state: "preparing", error: "" });
        const prepared = await preparePhoto(item.file);
        change(item.key, { state: "uploading" });
        const form = new FormData();
        form.set("photo", prepared, prepared.name);
        form.set("title", item.title);
        form.set("altText", item.altText);
        form.set("category", category);
        const response = await fetch("/api/admin/photos", { method: "POST", body: form, credentials: "same-origin" });
        if (response.status === 401) throw new Error("Your session has expired. Sign in again, then add this photo again.");
        if (!response.ok) throw new Error(await errorMessage(response, "The photo could not be uploaded. Please try again."));
        const saved = (await response.json()).photo as Photo;
        setPhotos(current => [saved, ...(current ?? [])]);
        change(item.key, { state: "done" });
        uploaded += 1;
      } catch (error) {
        failed += 1;
        change(item.key, { state: "failed", error: error instanceof Error && error.message !== "Failed to fetch" ? error.message : "The photo could not be uploaded. Check your connection and try again." });
      }
    }
    setBusy(false);
    if (!failed) {
      for (const item of checked) URL.revokeObjectURL(item.preview);
      setUploads([]);
      setFilter("all");
      setNotice(`${uploaded === 1 ? "Photo" : `${uploaded} photos`} uploaded. Tap Copy URL to use a photo on a web page.`);
    }
  }

  const counts = new Map<string, number>();
  for (const photo of photos ?? []) counts.set(photo.category, (counts.get(photo.category) ?? 0) + 1);
  const active = filter !== "all" && counts.has(filter) ? filter : "all";
  const search = query.trim().toLowerCase();
  const shown = (photos ?? []).filter(photo => (active === "all" || photo.category === active)
    && (!search || [photo.title, photo.altText, photo.fileName].some(text => text.toLowerCase().includes(search))));
  const pending = uploads.filter(item => item.state !== "done").length;
  const addButton = (
    <button type="button" className="adm-btn" onClick={() => picker.current?.click()} disabled={problem?.setup === true}>
      <Icon name="plus" size={18} /> Add photos
    </button>
  );

  return (
    <div className="adm-page">
      <PageHead
        title="Photos"
        subtitle={photos ? (photos.length === 1 ? "1 photo" : `${photos.length} photos`) : undefined}
        action={addButton}
      />
      <input
        ref={picker}
        type="file"
        accept={PHOTO_ACCEPT}
        multiple
        className="adm-sr-only"
        tabIndex={-1}
        aria-label="Choose photos"
        onChange={event => { choose(event.target.files); event.target.value = ""; }}
      />
      {notice && <p className="adm-inline-ok adm-photo-notice" role="status">{notice}</p>}

      {problem ? (
        problem.setup ? (
          <Card title="Photos are not switched on yet" tone="warn">
            <p className="adm-muted">{problem.message} Photo storage needs a one-off setup step in Supabase (see docs/photos.md).</p>
          </Card>
        ) : (
          <Card tone="warn">
            <p role="alert">{problem.message}</p>
            <div className="adm-actions"><button type="button" className="adm-btn adm-btn-ghost" onClick={() => void load()}>Try again</button></div>
          </Card>
        )
      ) : !photos ? (
        <Loading />
      ) : photos.length === 0 ? (
        <Empty icon="image" title="No photos yet">
          <p>Add photos from your phone or computer. Each one is turned the right way up, resized for the website and given a web address you can copy.</p>
          {addButton}
        </Empty>
      ) : (
        <>
          {counts.size > 1 && (
            <div className="adm-photo-filters">
              <Segmented
                label="Show category"
                value={active}
                options={[["all", `All ${photos.length}`], ...categoryOptions.filter(([value]) => counts.has(value)).map(([value, label]) => [value, `${label} ${counts.get(value)}`] as [PhotoCategory, string])]}
                onChange={setFilter}
              />
            </div>
          )}
          {photos.length > 6 && (
            <label className="adm-search">
              <Icon name="search" size={18} />
              <input type="search" placeholder="Search photo titles" value={query} onChange={event => setQuery(event.target.value)} aria-label="Search photos" />
            </label>
          )}
          <ul className="adm-photo-grid" aria-label="Photo library">
            {shown.map(photo => <li key={photo.id}><PhotoCard photo={photo} onEdit={() => { setNotice(""); setEditing(photo); }} /></li>)}
          </ul>
          {shown.length === 0 && <p className="adm-muted adm-pad">No photos match.</p>}
        </>
      )}

      <Sheet
        open={uploads.length > 0}
        onClose={closeUploads}
        title={uploads.length === 1 ? "Add photo" : `Add ${uploads.length} photos`}
        actions={
          <button type="button" className="adm-btn adm-btn-wide" disabled={busy || !pending} onClick={() => void uploadAll()}>
            <Icon name="upload" size={18} /> {busy ? "Uploading…" : uploads.some(item => item.state === "failed") ? "Try again" : pending === 1 ? "Upload photo" : `Upload ${pending} photos`}
          </button>
        }
      >
        <SelectField
          label="Category"
          value={category}
          options={categoryOptions}
          onChange={setCategory}
          hint={uploads.length > 1 ? "For all of these photos. You can change one later with its pencil button." : undefined}
        />
        <ul className="adm-uploads">
          {uploads.map((item, index) => {
            const locked = busy || item.state === "done";
            return (
              <li key={item.key}>
                <section className="adm-upload" aria-label={`Photo ${index + 1} of ${uploads.length}`}>
                  <div className="adm-upload-side">
                    {/* A local preview of the chosen file; HEIC previews only show in browsers that can open HEIC. */}
                    {/* eslint-disable-next-line @next/next/no-img-element -- a blob: preview, which next/image cannot load */}
                    <img className="adm-upload-preview" src={item.preview} alt="" onError={event => { event.currentTarget.style.visibility = "hidden"; }} />
                    {!locked && (
                      <button type="button" className="adm-link-danger" onClick={() => { URL.revokeObjectURL(item.preview); setUploads(current => current.filter(entry => entry.key !== item.key)); }}>
                        Remove
                      </button>
                    )}
                  </div>
                  <div className="adm-upload-fields">
                    <TextField
                      label="Title"
                      value={item.title}
                      onChange={title => change(item.key, { title, ...(item.state === "failed" ? { state: "waiting", error: "" } : {}) })}
                      maxLength={MAX_TITLE_LENGTH}
                      placeholder="e.g. Hallway repaint in Stockton Heath"
                      autoComplete="off"
                      disabled={locked}
                    />
                    <Field label="Description for Google" hint={index === 0 ? ALT_HINT : undefined}>
                      {control => <textarea {...control} className="adm-input adm-textarea" rows={2} maxLength={MAX_ALT_LENGTH} value={item.altText} disabled={locked} onChange={event => change(item.key, { altText: event.target.value })} />}
                    </Field>
                    {item.state === "failed" && item.error ? (
                      <p className="adm-inline-error" role="alert">{item.error}</p>
                    ) : stateLabels[item.state] && (
                      <p className={"adm-upload-state" + (item.state === "done" ? " is-done" : "")} role="status">
                        {item.state === "done" && <Icon name="check" size={14} />} {stateLabels[item.state]}
                      </p>
                    )}
                  </div>
                </section>
              </li>
            );
          })}
        </ul>
        <p className="adm-muted adm-small">
          Photos are turned the right way up, resized to 1600 px wide with a small thumbnail, and saved as WebP for fast loading.
          Location details from your phone are removed.
        </p>
      </Sheet>

      {editing && (
        <EditPhoto
          key={editing.id}
          photo={editing}
          onClose={() => setEditing(null)}
          onSaved={(saved, moved) => {
            setPhotos(current => (current ?? []).map(photo => photo.id === saved.id ? saved : photo));
            setEditing(null);
            setNotice(moved ? "Photo saved with a new web address. Copy the new address for any page that should use it." : "Photo saved.");
          }}
          onDeleted={id => {
            setPhotos(current => (current ?? []).filter(photo => photo.id !== id));
            setEditing(null);
            setNotice("Photo deleted.");
          }}
        />
      )}
    </div>
  );
}
