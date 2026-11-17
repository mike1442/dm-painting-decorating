import Link from "next/link";
import { publicMetadata } from "@/lib/site";
import { BusinessStructuredData } from "@/components/SeoStructuredData";
import RoomDesigner from "../../components/RoomDesigner";
export const metadata=publicMetadata("/room-designer","Virtual Room Colour Designer | D&M Painting & Decorating","Upload a room photo and explore wall colour ideas with D&M Painting & Decorating.");
export default function Page(){return <main className="dm-designer-page"><BusinessStructuredData/><Link href="/">← Back to D&M</Link><p className="dm-designer-eyebrow">D&M PAINTING & DECORATING</p><h1>Virtual room colour designer</h1><p>Try a new look before you decorate. Upload a photo, brush over the walls and experiment with colour.</p><RoomDesigner/><p>Ready to decorate? <Link href="/contact">Discuss your painting project with D&amp;M →</Link></p></main>}
