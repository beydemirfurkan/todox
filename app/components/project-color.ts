/**
 * A project's dot colour, picked from its id so it is the same on every page
 * and every visit. Decoration only: the project's name is always printed next
 * to the dot, so the colour never has to carry the meaning.
 */
const PROJECT_COLORS = ["#FF7A45", "#7AA2FF", "#C4A1FF", "#6FCF8A", "#FFC94D", "#5EC8D8"] as const;

export function projectColor(projectId: number): string {
  return PROJECT_COLORS[Math.abs(projectId) % PROJECT_COLORS.length];
}
