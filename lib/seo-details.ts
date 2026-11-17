type Section = readonly [string, string];
type ServiceDetail = { description: string; sections: Section[]; questions: Section[]; guides: string[] };

export const serviceDetails: Record<string, ServiceDetail> = {
  "interior-painting": {
    description: "Interior painters and decorators for homes across our working area. Walls, ceilings and room refreshes with careful preparation. Request a D&M quote.",
    sections: [
      ["Walls, ceilings and lived-in rooms", "A room refresh can cover walls and ceilings alone or include the doors, frames and skirting. Agreeing those surfaces at the start avoids surprises. Let us know whether the room will be occupied during the work and what furniture can be moved before arrival."],
      ["Preparation matched to the surface", "Sound existing paint needs a different approach from bare plaster, flaking coatings or a wall stripped of wallpaper. We assess filling, sanding, cleaning and primer requirements before choosing a coating system. Painting over loose material will not make it sound; stains and moisture need their cause considered before decoration."],
      ["What affects an interior painting quote?", "Room dimensions, ceiling height, access, surface condition, colour changes and the number of surfaces all affect the scope. Send photographs of the whole room and close-ups of damaged areas. Wallpaper removal or more extensive repairs should be agreed rather than assumed to be included in a repaint."],
    ],
    questions: [
      ["Can you decorate a hall, stairs and landing?", "Yes. Tell us whether ceilings, walls, stair joinery, doors and skirting are included. Stairwell height, access upstairs, loose paint and any wallpaper removal affect protection, preparation and the programme. Photographs looking up and down the stairs are a useful starting point."],
      ["Can you decorate just one room?", "Yes, enquiries can be for one room, several rooms or a whole home. Tell us the location and scope so we can discuss availability and the next step."],
      ["Does the room need to be empty?", "Clear access to the surfaces helps us work and protect your belongings. We will discuss furniture, floor protection and anything that needs moving before the work starts."],
    ], guides: ["why-preparation-matters", "planning-a-whole-house-redecoration"],
  },
  "woodwork-painting": {
    description: "Door, skirting and woodwork painting across Cheshire, Manchester and our surrounding service areas. D&M prepares existing joinery and agrees a suitable finish for your home.",
    sections: [
      ["Doors, frames and skirting", "Woodwork sets the edges of a room. We can discuss doors, architraves, skirting boards and other painted interior joinery alongside the walls or as a separate scope. Tell us how many items are involved and whether any existing finish is chipped, peeling or uneven."],
      ["A suitable coating system", "Bare timber, MDF and previously painted joinery can need different preparation and primers. Existing gloss also needs its adhesion and condition considered. Filling, careful abrasion, dust removal and compatible coatings are part of specifying the work; simply covering a failed coating is not a lasting repair."],
      ["Choosing sheen and planning access", "Discuss the appearance you want as well as how the surface is used. Colour, sheen, the existing coating and the manufacturer's recoat and curing guidance affect the work. Door access and drying time need planning, particularly in a busy home. Damaged or rotten joinery may need repair before it can be decorated."],
    ],
    questions: [
      ["Can dark woodwork be changed to a light finish?", "Often, but coverage and preparation depend on the existing coating and surface. Include photographs and the colour change in your enquiry so the system and scope can be assessed."],
      ["Are walls and ceilings included?", "Only where agreed. A woodwork quote should identify the doors, frames, skirting or other items included; room painting can be discussed at the same time."],
    ], guides: ["painting-woodwork-properly", "why-preparation-matters"],
  },
  "exterior-decorating": {
    description: "Exterior painting and decorating enquiries across Cheshire, Manchester and our surrounding service areas. D&M assesses surfaces, access and weather before agreeing the scope.",
    sections: [
      ["Start with condition and access", "Exterior decorating starts with the surface rather than the colour. Send photographs showing the full elevation and any cracked, peeling or damaged areas. Height, access around the building and the condition of existing coatings help determine whether the proposed work is suitable."],
      ["Preparation before a new coating", "Loose coatings, contamination and damaged substrate need assessment before repainting. A new finish cannot solve an underlying leak, persistent damp or rotten timber. Repairs outside the agreed decorating scope may need completing first. The preparation and coating system should suit the material and its exposure."],
      ["Weather and programme", "Exterior work depends on suitable application and drying conditions. Rain, temperature and surface moisture can affect when work can proceed, so dates may need flexibility. We discuss safe access and protection before confirming the programme; do not assume high-level access equipment is included without agreement."],
    ],
    questions: [
      ["Can you quote from photographs?", "Photographs are a useful starting point. A visit may still be needed to inspect the substrate, measure the work and assess access before a final scope can be agreed."],
      ["Will painting stop damp coming through?", "Decoration should follow investigation of the cause. Coatings are not a substitute for fixing water ingress or other building defects, and affected surfaces need suitable conditions before painting."],
    ], guides: ["why-preparation-matters"],
  },
  "whole-house-decorating": {
    description: "Whole-house decorating across Cheshire, Manchester and our surrounding service areas. Plan rooms, preparation, woodwork and access with D&M for a coordinated home refresh.",
    sections: [
      ["Define the work room by room", "A whole-home project needs a clear list of rooms and surfaces. Record whether each room includes ceilings, walls, doors, frames and skirting, along with any wallpaper removal or repairs. This makes quotes easier to compare and helps distinguish a simple refresh from a more extensive preparation programme."],
      ["A practical sequence for your home", "In an occupied property, think about where furniture can move and which rooms must remain usable. We discuss access, protection and room sequencing before the work starts. If other trades are involved, their repairs and dusty work need coordinating with the decorating programme."],
      ["Consistent colours and finishes", "Review samples in the rooms themselves before committing to a scheme. Daylight, artificial light and surrounding materials change how a colour looks. Agree finishes and record colour choices for each surface; later additions or changes can affect materials, time and the quoted scope."],
    ],
    questions: [
      ["Can we stay in the house?", "That depends on the scope and the spaces available. Tell us which rooms must stay accessible so that a workable sequence can be discussed before dates are agreed."],
      ["How long will it take?", "The number of rooms alone is not enough to estimate a programme. Surface condition, repairs, woodwork, access and coating drying times all matter. Share the scope and we can assess it."],
    ], guides: ["planning-a-whole-house-redecoration", "painting-woodwork-properly"],
  },
};

// Deliberate coverage groupings, not an arbitrary first eight entries.
const core = ["wigan", "leigh", "warrington"];
const cheshire = ["warrington", "stockton-heath", "grappenhall", "appleton", "lymm"];
const manchester = ["south-manchester", "altrincham", "hale", "bowdon"];
export function relatedAreaSlugs(slug: string): string[] {
  const group = manchester.includes(slug) ? manchester : cheshire.includes(slug) ? cheshire : core;
  return group.filter(s => s !== slug);
}
export const areaPlanning: Record<string, Section> = {
  wigan: ["Planning hall, stairs and landing work", "Include photographs looking up and down the stairwell as well as close-ups of the walls and woodwork. Stair height, handrails, floor coverings and access to upstairs rooms all affect protection and the sequence of work. Agree whether wallpaper stripping and repairs are part of the job before setting a date."],
  leigh: ["A clear scope for a room refresh", "When sending a Leigh enquiry, list the rooms and surfaces separately. A ceiling stain, wall repair or change from dark to light paint can need additional preparation. Include a full-room photograph and a close-up of each problem area so these details can be discussed before the quote is agreed."],
  warrington: ["Coordinating several rooms", "For a Warrington project involving several rooms, tell us which spaces need to stay usable and whether flooring or other trades are also booked. A room-by-room surface list, photographs and your preferred timing help establish the preparation, protection and order of work before dates are confirmed."],
};
export const guideServices: Record<string, string[]> = {
  "why-preparation-matters": ["interior-painting", "exterior-decorating"],
  "painting-woodwork-properly": ["woodwork-painting"],
  "planning-a-whole-house-redecoration": ["whole-house-decorating", "interior-painting"],
};
