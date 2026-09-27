/**
 * Fixed, GPU-cheap backdrop behind the module pages: three slow-drifting aurora fields (plain radial
 * gradients moved with transform — no blur filters), and a faint perspective grid.
 * Its tint follows the active module via data-page (colours are registered @properties, so they ease).
 */
export default function AmbientBackdrop({ page }) {
  return (
    <div className="tn-ambient" data-page={page} aria-hidden="true">
      <div className="tn-ambient-aurora tn-ambient-aurora--a" />
      <div className="tn-ambient-aurora tn-ambient-aurora--b" />
      <div className="tn-ambient-aurora tn-ambient-aurora--c" />
      <div className="tn-ambient-grid" />
    </div>
  );
}
