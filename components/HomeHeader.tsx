"use client";
import { useState } from "react";
import Link from "next/link";
function Arrow(){return <span aria-hidden="true">↗</span>}
export function HomeHeader(){const [menu,setMenu]=useState(false);return <header className="header"><a className="brand" href="#top" aria-label="D&M home"><img src="/dm-logo.svg" alt="D&M Painting & Decorating" width={175} height={92}/></a><nav className={menu?"nav open":"nav"} aria-label="Main navigation"><a href="#approach" onClick={()=>setMenu(false)}>Our approach</a><Link href="/services" onClick={()=>setMenu(false)}>What we do</Link><Link href="/areas" onClick={()=>setMenu(false)}>Areas we cover</Link><a href="#work" onClick={()=>setMenu(false)}>Our work</a><a className="nav-contact" href="/contact" onClick={()=>setMenu(false)}>Discuss a project <Arrow/></a></nav><button className="menu" onClick={()=>setMenu(!menu)} aria-expanded={menu} aria-label="Toggle menu">{menu?"Close":"Menu"} <span>{menu?"×":"☰"}</span></button></header>}
