export function DesktopCredentialGuide() {
  return (
    <div className="card-wh40k p-6" role="note">
      <h2 className="text-xl font-semibold mb-2">Native game connection</h2>
      <p>
        Use File → Game connection to connect your own official API key in a
        secure native dialog. Confirm your current workspace password when
        prompted. Use the same menu to sync current raids or remove the saved
        key.
      </p>
      <p className="mt-2 text-secondary-wh40k">
        This preview supports manual current-raid sync. Roster sync and upstream
        player ownership verification are still pending.
      </p>
    </div>
  )
}
