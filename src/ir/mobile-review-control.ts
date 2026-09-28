/** Pure policy for the mobile Review/Resume control's primary label. */
export function mobileReviewControlLabel(due: number, resume: boolean): string {
  if (due <= 0) return "Review";
  return `${resume ? "Resume" : "Review"} · ${due > 99 ? "99+" : due}`;
}
