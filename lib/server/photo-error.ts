/** A problem with the photo itself; the message is shown to Mike as it is. */
export class PhotoError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
