// Public SEO content. Location pages stick to decorating: what to consider
// before work starts and how D&M covers the area. No property-type or
// estate-agent descriptions, and business claims stay within what D&M has
// confirmed (based around Warrington, selected South Manchester projects).
export type Faq = { q: string; a: string };
export type Point = { title: string; text: string };
export type Area = {
  slug: string; name: string; placeName: string; label: string;
  parent?: string; // the area hub this place sits under
  region?: Point; // hubs only: how the cluster is introduced on /areas
  metaTitle: string; metaDescription: string;
  intro: string; coverage?: string; detail: string; focus: string;
  considerations: Point[]; nearby: string[]; guide: string; faqs: Faq[];
};
export type Service = {
  slug: string; name: string; h1: string; short: string;
  metaTitle: string; metaDescription: string; intro: string;
  included: Point[]; approach: string[]; projects?: string[]; guides: string[]; faqs: Faq[];
};
export type Guide = { slug: string; title: string; intro: string; sections: [string, string][]; services: string[] };

export const areas: Area[] = [
{slug:"warrington",name:"Warrington",placeName:"Warrington",label:"WA1–WA5 · CHESHIRE",
region:{title:"Warrington & nearby villages",text:"Our home area: the town itself and the villages to the south and east, from Stockton Heath and Grappenhall to Appleton and Lymm."},
metaTitle:"Painters & Decorators in Warrington, Cheshire | D&M",
metaDescription:"Preparation-led painters and decorators in Warrington, from single rooms to whole houses. Covering the town plus Stockton Heath, Grappenhall, Appleton and Lymm.",
intro:"Considered decorating for homes across Warrington, from individual room refreshes to carefully planned full-property projects.",
coverage:"Warrington is where we're based. We work across the town and the nearby villages, including Stockton Heath, Grappenhall, Appleton and Lymm.",
detail:"In busy family homes, protecting floors and furniture, managing dust and agreeing a realistic room-by-room schedule are as important as the finished paintwork.",
focus:"Careful interior preparation and coordinated home refreshes",
considerations:[
{title:"New plaster",text:"Fresh plaster needs to be fully dry and sealed with a mist coat or suitable primer before colour coats go on. Skipping that step leaves a patchy finish that can peel."},
{title:"Hairline cracks",text:"Fine cracks at ceiling joints and corners are best raked out, filled and sanded before painting, rather than painted over and left to reappear within months."},
{title:"Keeping the house usable",text:"Decorating usually has to fit around family life, so work is sequenced room by room, keeping the kitchen, bathroom and bedrooms usable for as long as possible."}],
nearby:["stockton-heath","grappenhall","appleton","lymm"],guide:"painting-new-plaster",
faqs:[
{q:"What helps you price a decorating job?",a:"Where the property is, which rooms or surfaces need decorating and their condition, including any cracks, repairs or old wallpaper. Photos really help us understand the preparation involved."},
{q:"Can you decorate room by room so we can stay in the house?",a:"Yes. A room-by-room schedule is agreed before work starts, so you know which rooms will be out of use at each stage and the rest of the house stays usable."}]},
{slug:"stockton-heath",name:"Stockton Heath",placeName:"Stockton Heath, Warrington",label:"WA4 · WARRINGTON",parent:"warrington",
metaTitle:"Painters & Decorators in Stockton Heath, WA4 | D&M",
metaDescription:"Interior and woodwork decorating in Stockton Heath, WA4. Careful preparation, crisp detailing and finishes chosen for the surfaces and the light.",
intro:"Interior painting and decorating for Stockton Heath homes where clean detailing and well-prepared surfaces make all the difference.",
detail:"For period features, decorative woodwork and modern extensions alike, the right preparation and finish selection should follow the actual condition of the surfaces.",
focus:"Woodwork, crisp edges and refined interior finishes",
considerations:[
{title:"Woodwork detail",text:"Doors, architraves and skirting can carry many layers of old paint, which blur mouldings and hide damage. Careful cleaning, sanding and filling keeps the detail crisp rather than adding another heavy coat."},
{title:"Old paint and lead",text:"Paint applied before the 1960s may contain lead. It shouldn't be dry-sanded or burnt off, so suspect surfaces should be tested and prepared with wet or low-dust methods."},
{title:"Strong daylight",text:"Large windows and roof lights throw raking light across walls and ceilings, showing every imperfection. Thorough filling and sanding, and a finish chosen for the light, make the difference."}],
nearby:["warrington","grappenhall","appleton"],guide:"decorating-older-surfaces",
faqs:[
{q:"Can old woodwork be repainted without losing its detail?",a:"Usually, yes. The key is preparation: cleaning, sanding back loose paint and heavy build-up, filling only where needed and applying a suitable primer and finish. Rushing straight to a top coat is what fills in mouldings and leaves runs."},
{q:"Why do some walls show every mark?",a:"Large windows and roof lights create raking light that highlights uneven plaster, filler and roller marks. Extra preparation and a flatter finish usually give a more even appearance."}]},
{slug:"grappenhall",name:"Grappenhall",placeName:"Grappenhall, Warrington",label:"WA4 · WARRINGTON",parent:"warrington",
metaTitle:"Painters & Decorators in Grappenhall, WA4 | D&M",
metaDescription:"Preparation-led painting and decorating in Grappenhall, WA4. Walls, ceilings and joinery repaired, primed and finished properly, including textured ceilings.",
intro:"Preparation-led painting and decorating for homes in Grappenhall and the surrounding area.",
detail:"Whether refreshing established interiors or finishing recently renovated rooms, we focus on surface assessment, careful protection and a consistent final appearance.",
focus:"Established homes, walls, ceilings and joinery",
considerations:[
{title:"Textured ceilings",text:"Sound textured, Artex-style ceilings can usually be painted as they are. Coatings applied before 2000 may contain asbestos, so they shouldn't be sanded, scraped or drilled until tested."},
{title:"Patch repairs",text:"Hairline cracks, old patch repairs and subtle changes in texture show through new paint. Raking out, filling and spot-priming repairs gives a consistent finish across the whole wall."},
{title:"New and old surfaces together",text:"Where rooms have been replastered or reconfigured, new and old surfaces sit side by side and absorb paint differently. Sealing new work properly prevents a patchy sheen in the finish."}],
nearby:["stockton-heath","appleton","lymm","warrington"],guide:"why-preparation-matters",
faqs:[
{q:"Can you paint over an Artex or textured ceiling?",a:"A sound textured ceiling can usually be painted. Because textured coatings applied before 2000 may contain asbestos, they shouldn't be sanded, scraped or removed without testing first, and any concerns are raised when the work is assessed."},
{q:"Why does paint look patchy over repaired walls?",a:"Filler and new plaster absorb paint differently from the surrounding wall. Spot-priming repairs and applying full, even coats avoids 'flashing', where patches dry with a different sheen."}]},
{slug:"appleton",name:"Appleton",placeName:"Appleton, Warrington",label:"WA4 · WARRINGTON",parent:"warrington",
metaTitle:"Painters & Decorators in Appleton, Warrington | D&M",
metaDescription:"Considered painting and decorating in Appleton, Warrington, including tall stairwells and multi-room projects needing careful planning and consistent finishes.",
intro:"Premium painting and decorating for homeowners in Appleton who value a considered approach.",
detail:"Larger homes and multi-room projects benefit from planned sequencing, consistent colour and sheen choices, and careful attention to the junctions between walls, ceilings and woodwork.",
focus:"Multi-room schemes and detailed finishing",
considerations:[
{title:"Stairwells and landings",text:"Tall stairwells and landings need a safe working platform rather than a ladder alone. Access is planned before work starts so walls and ceilings can be prepared properly at height."},
{title:"Consistency across rooms",text:"In open-plan and connected spaces, the same colour can look different under different light and sheen levels. Agreeing products, sheens and colours across the scheme keeps the house reading as one."},
{title:"Junctions and edges",text:"Crisp lines where walls meet ceilings, skirting and door frames are what make a room look finished. Caulking gaps and cutting in carefully takes time, but it's where quality shows."}],
nearby:["stockton-heath","grappenhall","warrington"],guide:"planning-a-whole-house-redecoration",
faqs:[
{q:"How are tall stairwells decorated safely?",a:"Usually with a staircase platform or a small tower that gives a stable working surface over the stairs. The right access depends on the layout and is agreed as part of the scope."},
{q:"Should every room use the same paint finish?",a:"Not necessarily. Walls often suit a matt finish, while hallways, kitchens and children's rooms benefit from more durable, washable products. Keeping the sheen consistent within connected spaces avoids obvious changes where rooms meet."}]},
{slug:"lymm",name:"Lymm",placeName:"Lymm, Warrington",label:"WA13 · WARRINGTON",parent:"warrington",
metaTitle:"Painters & Decorators in Lymm, WA13 | D&M",
metaDescription:"Thoughtful painting and decorating in Lymm, WA13, with proper preparation at the centre of every project, including breathable finishes for lime plaster.",
intro:"Thoughtful interior decorating for Lymm homes, with proper preparation at the centre of every project.",
detail:"Every interior calls for an approach suited to its existing surfaces and architectural details.",
focus:"Traditional features and carefully finished interiors",
considerations:[
{title:"Lime plaster and solid walls",text:"Lime plaster and solid walls need to let moisture escape. Modern vinyl emulsions can trap it, causing blistering and flaking, so breathable paints are often the better choice on these surfaces."},
{title:"Listed buildings and conservation areas",text:"If your home is listed, or in a conservation area with extra planning controls, check with Warrington Borough Council before changing external colours or materials."},
{title:"Exposed exteriors",text:"Timber windows, doors and fascias facing the weather, or close to water, need sound preparation and a suitable exterior system to keep moisture out."}],
nearby:["grappenhall","bowdon","altrincham","warrington"],guide:"decorating-older-surfaces",
faqs:[
{q:"What paint is best for lime plaster?",a:"A breathable (vapour-permeable) paint, such as a mineral or lime-compatible emulsion, is usually recommended so moisture can escape from solid walls. Check the manufacturer's guidance for lime plaster and avoid sealing it with a standard vinyl emulsion."},
{q:"Do I need permission to repaint the outside of my house?",a:"For most homes, no. If the property is listed, consent may be needed for changes that affect its character, and some conservation areas have extra controls. Warrington Borough Council's planning team can confirm what applies."}]},
{slug:"altrincham",name:"Altrincham",placeName:"Altrincham, Trafford",label:"WA14 & WA15 · TRAFFORD",parent:"south-manchester",
metaTitle:"Painters & Decorators in Altrincham | D&M",
metaDescription:"Detail-focused painting and decorating in Altrincham, from single rooms to complete interior refreshes. Careful preparation, crisp joinery and lasting finishes.",
intro:"Detail-focused painting and decorating for Altrincham homes, from living spaces to complete interior refreshes.",
detail:"Older plasterwork, existing painted joinery and high-use family spaces can require different preparation methods. We assess the work rather than promising a one-size-fits-all finish.",
focus:"Period joinery and modern residential interiors",
considerations:[
{title:"Cracked plaster and ceilings",text:"Hairline cracks can usually be raked out, filled and sanded before painting. Wider or recurring cracks, bulging ceilings or loose plaster need assessing first, because painting over them won't fix the cause."},
{title:"Painted joinery",text:"Panelled doors, architraves and deep skirting need careful keying, filling and a primer suited to the existing coating, especially when moving from oil-based gloss to water-based finishes."},
{title:"High-use spaces",text:"Hallways, kitchens and stairs take the most wear. Durable, washable finishes in these areas keep the house looking fresh for longer."}],
nearby:["hale","bowdon","south-manchester","lymm"],guide:"decorating-older-surfaces",
faqs:[
{q:"Can cracked plaster be painted over?",a:"Fine hairline cracks can be raked out, filled, sanded and primed before painting. Wider cracks, bulging areas or plaster that sounds hollow should be assessed first, as they can indicate movement or plaster losing its key."},
{q:"Can I switch from oil-based gloss to water-based paint on woodwork?",a:"Yes, with the right preparation. Old gloss needs cleaning and sanding to provide a key, followed by an adhesion primer or undercoat recommended for the new system. Without that step, water-based paint can peel."}]},
{slug:"hale",name:"Hale",placeName:"Hale, Trafford",label:"WA15 · TRAFFORD",parent:"south-manchester",
metaTitle:"Painters & Decorators in Hale, WA15 | D&M",
metaDescription:"Refined painting and decorating in Hale, WA15, with careful preparation, premium paint finishes and close attention to detail.",
intro:"Refined painting and decorating for homes in Hale, with particular care given to preparation, protection and finish.",
detail:"Where decorative details and specialist paint finishes matter, we believe surface condition, appropriate materials and precise application should guide the specification.",
focus:"Detailed interiors and premium finish selection",
considerations:[
{title:"Designer paint finishes",text:"Premium ranges such as Farrow & Ball or Little Greene offer real depth of colour, but very flat finishes can mark more easily and touch-ups can show. Choosing the right finish for each room balances appearance with durability."},
{title:"Specification first",text:"Each surface needs the correct primer and system, applied as the manufacturer intends. The tin alone doesn't guarantee the finish; the preparation and application do."},
{title:"Colour and light",text:"Strong, deep colours and large glazed spaces change throughout the day. Testing sample patches on different walls, in daylight and evening light, avoids surprises."}],
nearby:["altrincham","bowdon","south-manchester"],guide:"why-preparation-matters",
faqs:[
{q:"Are designer paints worth the extra cost?",a:"They can be, particularly for depth of colour and a refined, flat finish. The trade-off is that some ultra-matt finishes are less washable, so busy areas may suit a more durable product from the same colour range."},
{q:"How should I test a paint colour?",a:"Paint large sample patches, or use painted sample boards, on more than one wall, and look at them in daylight and artificial light over a few days before deciding."}]},
{slug:"bowdon",name:"Bowdon",placeName:"Bowdon, Trafford",label:"WA14 · TRAFFORD",parent:"south-manchester",
metaTitle:"Painters & Decorators in Bowdon, WA14 | D&M",
metaDescription:"Careful decorating in Bowdon, WA14: high ceilings, cornices, sash windows and traditional woodwork, prepared properly and finished to last.",
intro:"Careful decorating for Bowdon homes, with an emphasis on existing features and a lasting, consistent finish.",
detail:"High ceilings, cornices and timber details can require additional access, masking and surface preparation. We discuss these requirements before setting the scope.",
focus:"Architectural detailing and traditional woodwork",
considerations:[
{title:"Cornices and old ceilings",text:"Decorative plasterwork can be clogged with decades of paint, and some old ceilings still carry distemper, which modern emulsion won't bond to. These surfaces need identifying and treating before any new coat goes on."},
{title:"Sash windows and timber",text:"Timber sashes and doors need careful preparation so new paint doesn't build up and stop them operating, with a suitable exterior system on the outer faces."},
{title:"Height and access",text:"Tall rooms and stairwells need stable access equipment and extra masking time. Planning this up front keeps the work safe and the finish consistent."}],
nearby:["altrincham","hale","lymm"],guide:"decorating-older-surfaces",
faqs:[
{q:"Why is paint flaking off my ceiling or cornice?",a:"A common cause on old ceilings is distemper, a traditional chalk-based paint that modern emulsions can't grip. It usually needs washing off or sealing with a specialist primer before redecorating."},
{q:"Does a conservation area affect exterior painting?",a:"Repainting in the existing colours is often straightforward, but listed buildings and some conservation areas have extra controls on external changes. Trafford Council can confirm what applies to your property."}]},
{slug:"south-manchester",name:"South Manchester",placeName:"South Manchester",label:"TRAFFORD & SOUTH MANCHESTER",
region:{title:"South Manchester & Trafford",text:"Selected projects in Altrincham, Hale and Bowdon, and in Sale, Didsbury and nearby suburbs where the project is a good fit."},
metaTitle:"Painters & Decorators in South Manchester | D&M",
metaDescription:"Preparation-first painting and decorating across South Manchester and Trafford, including Altrincham, Hale, Bowdon, Sale and Didsbury.",
intro:"Preparation-first painting and decorating across selected South Manchester neighbourhoods.",
coverage:"Beyond our Warrington base, we take on selected projects across South Manchester and Trafford. Altrincham, Hale and Bowdon each have their own page; Sale, Didsbury and nearby suburbs are covered on a project-by-project basis.",
detail:"For projects in areas such as Sale, Didsbury and nearby suburbs, we discuss access, project size and timing before confirming whether the job is a good fit.",
focus:"Larger residential projects and considered interior schemes",
considerations:[
{title:"Shared buildings",text:"In flats and shared buildings, communal areas, working hours and access are often governed by a lease or managing agent. Checking these rules early avoids delays."},
{title:"Parking and access",text:"Busy streets and parking restrictions affect how materials and equipment reach the property. These practicalities are discussed before the work is scheduled."},
{title:"Layered paint and cracked plaster",text:"Layered paint, cracked plaster and worn joinery need proper preparation before a lasting finish, wherever the job is."}],
nearby:["lymm","warrington"],guide:"decorating-older-surfaces",
faqs:[
{q:"Do you cover Sale and Didsbury?",a:"Yes, selectively. Sale, Didsbury and nearby suburbs are within our wider working area, and we confirm each project based on its size, timing and access."},
{q:"What should I check before decorating a flat?",a:"Check your lease, or ask the managing agent, about rules for communal areas, working hours and access. Inside the flat, the main practical points are parking, where materials can be stored and how furniture will be protected."}]}
];

export const services: Service[] = [
{slug:"interior-painting",name:"Interior painting",h1:"Interior painting & decorating",short:"Walls, ceilings and carefully finished living spaces.",
metaTitle:"Interior Painting in Warrington & South Manchester | D&M",
metaDescription:"Interior painting and decorating in Warrington and South Manchester. Walls and ceilings properly assessed, repaired, primed and finished with care.",
intro:"Beautiful walls and ceilings begin with surfaces that have been properly assessed, repaired and prepared.",
included:[
{title:"Protection first",text:"Floors, furniture and surrounding finishes are protected before any preparation begins."},
{title:"Repairs and preparation",text:"Cracks, dents and old fixing holes are raked out, filled and sanded, with preparation matched to the surface: new plaster, previously painted walls or patched areas."},
{title:"The right primer",text:"New plaster, repairs and stains each need a suitable primer or sealer so the finish dries evenly and marks don't bleed through."},
{title:"A consistent finish",text:"Clean cutting-in at ceilings, skirting and frames, and even coats across each wall, give a finish that looks right in every light."}],
approach:["We begin by understanding the existing surfaces, the desired result and the practical needs of your home. The exact preparation and coating specification depends on what we find.","Finish matters as much as colour. Flat matt hides minor imperfections but can mark in busy areas; durable matt, eggshell and kitchen and bathroom formulations stand up better to cleaning and moisture."],
projects:["Living rooms, bedrooms and hallways","Kitchens and bathrooms that need durable or moisture-resistant finishes","Newly plastered rooms and extensions","Ceilings with cracks or old stains"],
guides:["why-preparation-matters","painting-new-plaster"],
faqs:[
{q:"How long should new plaster dry before painting?",a:"It depends on the plaster thickness, ventilation and time of year, but it is often several weeks. The surface should be an even, light colour with no darker damp patches. The first coat is usually a mist coat or a primer recommended by the paint manufacturer."},
{q:"Which paint finish is best for kitchens, bathrooms and hallways?",a:"A durable or washable matt, an eggshell, or a dedicated kitchen and bathroom paint. These resist scuffs, cleaning and moisture better than a standard flat matt emulsion."},
{q:"Do I need to empty the room first?",a:"It helps to remove ornaments, pictures and small items. Larger furniture can usually be grouped and covered; what needs moving is agreed before work starts."}]},
{slug:"woodwork-painting",name:"Woodwork & detailing",h1:"Woodwork painting & detailing",short:"Doors, skirting, frames and the finishing details.",
metaTitle:"Woodwork Painting in Warrington & South Manchester | D&M",
metaDescription:"Doors, frames, skirting and decorative joinery painted with careful preparation, the right primer and a smooth, durable finish. Warrington and South Manchester.",
intro:"Doors, frames, skirting and decorative joinery deserve as much attention as the walls around them.",
included:[
{title:"Coating inspection",text:"Existing finishes are checked first: oil-based gloss, water-based satin and bare or stained timber each need a different approach."},
{title:"Sanding and filling",text:"Dents, nail holes, open joints and old brush marks are filled, sanded and caulked so edges are sharp and surfaces smooth."},
{title:"Primer and finish specification",text:"Primer, undercoat and topcoat are chosen to work together, with drying and recoat times respected between coats."},
{title:"Detail work",text:"Panelled doors, architraves and mouldings are painted in a careful order so edges stay clean and runs don't form in the detail."}],
approach:["Woodwork is where rushed decorating shows first: drips at the bottom of a door panel, brush marks in gloss, or paint peeling from an unprepared surface. Time spent on preparation is what makes the finish look sharp and last.","Water-based finishes dry faster, have less odour and generally keep their colour, while traditional oil-based gloss can yellow over time, particularly away from daylight. The right system depends on the existing coating and how the woodwork is used."],
projects:["Internal doors, frames and architraves","Skirting boards, dado and picture rails","Decorative joinery and mouldings","Moving from old oil-based gloss to water-based finishes"],
guides:["painting-woodwork-properly","decorating-older-surfaces"],
faqs:[
{q:"Can water-based paint go over old oil-based gloss?",a:"Yes, with the right preparation: cleaning, sanding to a key and an adhesion primer or undercoat recommended for the new system. Without that, water-based paint can peel from old gloss."},
{q:"Why has my white gloss turned yellow?",a:"Oil-based paints naturally yellow with age, especially in rooms or areas with less daylight. Water-based systems are generally much better at holding their colour."},
{q:"Is old woodwork paint safe to sand?",a:"Paint applied before the 1960s may contain lead. It shouldn't be dry-sanded or burnt off; suspected lead paint should be tested and prepared with wet or low-dust methods."}]},
{slug:"exterior-decorating",name:"Exterior decorating",h1:"Exterior painting & decorating",short:"Thoughtful exterior preparation and durable finishes.",
metaTitle:"Exterior Decorating in Warrington & South Manchester | D&M",
metaDescription:"Exterior painting and decorating in Warrington and South Manchester, with proper preparation, suitable coatings and planning around access and weather.",
intro:"Exterior work requires careful assessment of exposure, weather, access and the condition of existing finishes.",
included:[
{title:"Surface preparation",text:"Loose and flaking coatings are removed, edges feathered back and surfaces cleaned so new paint bonds to a sound base."},
{title:"Suitable exterior systems",text:"Each exterior surface needs a coating system made for exposure, chosen to suit the material and its condition."},
{title:"Access and safety",text:"Ladders, towers or other access are planned around the height and layout of the building before work starts."},
{title:"Weather planning",text:"Work is scheduled around dry conditions and suitable temperatures, because damp surfaces, frost and dew can spoil a new coat."}],
approach:["The outside of a house takes the brunt of the weather, and elevations facing the prevailing wind and rain usually deteriorate first. Assessing each elevation separately shows where preparation needs to be most thorough.","Typical exterior surfaces include timber windows and doors, fascias and soffits, and painted masonry. Exactly what's included is agreed in the scope once the surfaces have been assessed."],
guides:["why-preparation-matters","decorating-older-surfaces"],
faqs:[
{q:"When is the best time of year for exterior painting?",a:"Generally late spring to early autumn, when surfaces are dry and temperatures stay within the paint manufacturer's limits. Frost, dew, rain and very strong sun can all affect how a coating dries."},
{q:"How often does exterior paintwork need redoing?",a:"It varies with the surface, the coating used and how exposed each elevation is. Checking paintwork every year and dealing with early damage helps extend the life of the finish."},
{q:"Will I need scaffolding?",a:"It depends on the height of the building and what needs decorating. Access is assessed and agreed as part of the scope before any work is booked."}]},
{slug:"whole-house-decorating",name:"Whole-house decorating",h1:"Whole-house decorating",short:"A consistent, considered finish throughout your home.",
metaTitle:"Whole-House Decorating | Warrington & South Manchester | D&M",
metaDescription:"Full-home redecoration planned room by room, with consistent preparation, colours and finishes throughout. Warrington, Cheshire and South Manchester.",
intro:"A coordinated decorating programme creates consistency across rooms without losing sight of the details.",
included:[
{title:"Clear sequencing",text:"A room-by-room plan sets out what happens when, so you know which rooms will be out of use at each stage."},
{title:"Consistent preparation",text:"Every room is prepared to the same standard, so the finish doesn't vary between the rooms you see first and the rest of the house."},
{title:"Joined-up colour and finish choices",text:"Products, sheens and colours are agreed across the whole scheme, so connected spaces read as one."},
{title:"Protection and handover",text:"Floors, furniture and fittings are protected throughout, and each room is handed back clean and tidy."}],
approach:["Decorating a whole house is as much about planning as painting. Agreeing the scope, the order of rooms and the colour scheme at the start reduces disruption and keeps finishes consistent from room to room.","Empty properties, before a move or after building work, can often be decorated more quickly because rooms are easier to protect and prepare. Lived-in homes simply need more careful sequencing."],
projects:["Preparing a newly bought home before moving in","Refreshing a family home throughout","Finishing a property after renovation or extension work","Multi-room schemes that need consistent colours and finishes"],
guides:["planning-a-whole-house-redecoration","painting-new-plaster"],
faqs:[
{q:"Can we live in the house while it's being decorated?",a:"Usually, yes. Planning the order of rooms keeps bedrooms, the kitchen and the bathroom usable for as long as possible."},
{q:"Is it better to decorate before moving in?",a:"If you can, yes. Empty rooms are quicker to protect and prepare, and there's no furniture to work around. It's also a good moment to deal with repairs."},
{q:"How are colours kept consistent across the house?",a:"By agreeing products and sheens across the scheme, ordering enough of each colour, and testing samples in the actual rooms in daylight and artificial light before committing."}]}
];

export const guides: Guide[] = [
{slug:"why-preparation-matters",title:"Why preparation matters more than the final coat",intro:"A premium finish is not simply a premium tin of paint. Learn what makes surface preparation essential.",services:["interior-painting","exterior-decorating"],sections:[["Assess before painting","Different substrates and old coatings behave differently. Check for cracks, loose paint, stains, moisture and movement before selecting products."],["Protect the room first","Floors, furniture and fittings should be covered before sanding begins. Dust travels further than you expect, and it's far easier to prevent than to clean up."],["Repair and smooth","Filling, sanding and feathering edges reduce the chance of imperfections showing through the final finish. Dust should be removed before coating."],["Prime where appropriate","Bare plaster, patched areas and difficult surfaces may need different primers or sealing systems. Follow the coating manufacturer's instructions."],["Check the light","Walls lit from the side by windows or roof lights show every dent and ridge. Assess surfaces in the light they'll be seen in, and prepare them to that standard."],["Don't rush the coats","Each coat needs its full drying and recoat time. Applying the next coat too soon can cause poor adhesion, uneven sheen and a finish that fails early."]]},
{slug:"painting-woodwork-properly",title:"What goes into beautifully finished woodwork?",intro:"Good woodwork finishing depends on the existing coating, substrate condition and the preparation between coats.",services:["woodwork-painting"],sections:[["Check the existing finish","Gloss, satin and water-based systems may have different preparation and adhesion requirements."],["Take time over the details","Nail holes, joints, sharp edges and old brush marks should be assessed and treated appropriately."],["Choose a suitable system","Primer, undercoat and topcoat need to work together. Drying and recoat times matter as much as application."],["Watch for older coatings","Paint from before the 1960s can contain lead. It shouldn't be dry-sanded or burnt off; test suspect surfaces and use wet or low-dust preparation methods."],["Expect gloss to yellow","Oil-based gloss can yellow over time, especially away from daylight. Water-based systems usually hold their colour better but need the right primer over old gloss."]]},
{slug:"planning-a-whole-house-redecoration",title:"Planning a whole-house redecoration",intro:"A little planning reduces disruption and helps keep finishes consistent from room to room.",services:["whole-house-decorating","interior-painting"],sections:[["Agree the scope","Record every room, surface, finish and any repairs or access requirements before work begins."],["Allow for repairs","Cracks, loose plaster and damaged woodwork are easier to deal with as part of the plan than to discover halfway through. Note them during the first walk-round."],["Plan room sequencing","Consider how occupants will use the home, where furniture can move and which spaces need to remain accessible."],["Review colours and lighting","Test samples in the actual rooms and review them in daylight and artificial light before committing."],["Think about timing","Decorating before moving in, or before new flooring is fitted, avoids working around furniture and keeps paint and dust off new floors."]]},
{slug:"decorating-older-surfaces",title:"Decorating older surfaces: lead, distemper and lime plaster",intro:"Older surfaces often hide coatings and plaster that modern paint doesn't suit. Knowing what to look for avoids flaking, peeling and unsafe preparation.",services:["woodwork-painting","interior-painting"],sections:[["Lead paint on woodwork and windows","Paint applied before the 1960s may contain lead. Dry sanding and burning off create hazardous dust and fumes, so test suspect surfaces first and use wet abrading or other low-dust methods."],["Distemper on ceilings and cornices","Distemper is a traditional chalk-based paint still found on some old ceilings and cornices. Modern emulsion won't grip it, so it needs washing off or sealing with a suitable primer before redecorating."],["Lime plaster and solid walls","Solid walls and lime plaster need to release moisture. Breathable paints are usually the better choice; standard vinyl emulsions can trap moisture and cause blistering."],["Cracks and movement","Hairline cracks in old plaster can be raked out and filled. Wide, recurring or bulging cracks should be assessed before decorating, as they may indicate movement or failing plaster."],["Listed buildings and conservation areas","Repainting inside an unlisted home needs no permission. For listed buildings, or for external changes in some conservation areas, check with your local council first."]]},
{slug:"painting-new-plaster",title:"Painting new plaster: when and how",intro:"Fresh plaster needs a slightly different approach. Drying time, early cracking and the first coat all affect how well the finish lasts.",services:["interior-painting","whole-house-decorating"],sections:[["Let it dry out","New plaster needs time to dry fully, often several weeks depending on thickness, ventilation and the time of year. It should be an even, light colour with no darker damp patches."],["Expect early cracking","Fine cracks at ceiling joints, corners and around door frames are common as new plaster and timber dry out. They are best raked out, filled and sanded before the next full redecoration."],["Seal it properly","Bare plaster is very absorbent. It needs a mist coat or a primer recommended by the paint manufacturer before colour coats, or the finish can be patchy and peel."],["Upgrade basic contract paint","Newly plastered walls are often finished in a basic contract emulsion that marks easily. Repainting with a more durable, washable finish stands up better to everyday use."]]}
];

export function bySlug<T extends {slug:string}>(items:readonly T[],slug:string){return items.find(x=>x.slug===slug)}
export const areaHubs = areas.filter(a => !a.parent);
export const childAreas = (hub: string) => areas.filter(a => a.parent === hub);
