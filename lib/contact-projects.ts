export const contactProjects = [
  ["room", "One room"],
  ["rooms", "Several rooms"],
  ["house", "Whole house"],
  ["hall-stairs-landing", "Hall, stairs and landing"],
  ["woodwork", "Woodwork / doors / skirting"],
  ["exterior", "Exterior decorating"],
  ["commercial", "Commercial decorating"],
  ["landlord", "Landlord / letting agent decorating"],
  ["other", "Something else / not sure"],
] as const;
export function projectLabel(key: string | null) {
  return contactProjects.find(([slug]) => slug === key)?.[1] || "";
}
