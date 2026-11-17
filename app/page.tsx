import HomePage from "@/components/HomePage";
import { BusinessStructuredData } from "@/components/SeoStructuredData";
import { publicMetadata } from "@/lib/site";
export const metadata = publicMetadata("/", "Painters & Decorators Wigan, Leigh & Warrington | D&M", "D&M Painting & Decorating: interior painting, woodwork and whole-home decorating in Wigan, Leigh and Warrington. Tell us about your project and request a quote.");
export default function Page() { return <><BusinessStructuredData/><HomePage/></>; }
