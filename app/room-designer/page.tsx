import Link from "next/link";
import RoomDesigner from "../../components/RoomDesigner";
import { pageMetadata } from "@/lib/seo";
export const metadata=pageMetadata({title:"Virtual Room Colour Designer | D&M Painting & Decorating",description:"Upload a photo of your room and preview wall colour ideas before you decorate. Free to use, works on your phone, no sign-up required.",path:"/room-designer"});
export default function Page(){return <main className="dm-designer-page"><Link href="/">← Back to D&M</Link><p className="dm-designer-eyebrow">D&M PAINTING & DECORATING</p><h1>Virtual room colour designer</h1><p>Try a new look before you decorate. Upload a photo, brush over the walls and experiment with colour.</p><RoomDesigner/></main>}
