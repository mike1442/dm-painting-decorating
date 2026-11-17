import HomePage from "@/components/HomePage";
import { BusinessStructuredData } from "@/components/SeoStructuredData";
import { publicMetadata } from "@/lib/site";
export const metadata = publicMetadata("/", "Painting & Decorating in Cheshire & Manchester | D&M", "Preparation-led painting and decorating for homeowners, landlords and businesses. Individual rooms, whole homes, woodwork and exterior decorating. Enquire with D&M.");
export default function Page() { return <><BusinessStructuredData/><HomePage/></>; }
