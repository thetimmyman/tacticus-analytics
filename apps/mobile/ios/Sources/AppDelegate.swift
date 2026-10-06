import UIKit
import UniformTypeIdentifiers

@main final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?
    private var controller: WorkspaceController?
    func application(_ application: UIApplication, didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        let window = UIWindow(frame: UIScreen.main.bounds)
        let controller = WorkspaceController()
        self.controller = controller
        window.rootViewController = UINavigationController(rootViewController: controller)
        self.window = window; window.makeKeyAndVisible()
        return true
    }
    func applicationWillResignActive(_ application: UIApplication) { controller?.suspend() }
    func applicationDidBecomeActive(_ application: UIApplication) { controller?.resume() }
    func applicationProtectedDataWillBecomeUnavailable(_ application: UIApplication) { controller?.suspend() }
    func applicationProtectedDataDidBecomeAvailable(_ application: UIApplication) { controller?.resume() }
}

@MainActor final class WorkspaceController: UIViewController, UIDocumentPickerDelegate {
    private let content = UIStackView()
    private let veil = UIView()
    private var store: WorkspaceStore?
    private var supervisor: ConnectionSupervisor?
    private let vault = CredentialVault()
    private var task: Task<Void, Never>?
    private var temporaryExport: URL?
    private weak var secureField: UITextField?
    private var status = "Connect Player to start personal content. Existing local history remains readable offline."
    private var offline = true
    private var demo = false
    override func viewDidLoad() {
        super.viewDidLoad(); title = "Tacticus workspace"; view.backgroundColor = .systemBackground
        #if targetEnvironment(simulator)
        demo = ProcessInfo.processInfo.arguments.contains("--synthetic-demo")
        #endif
        let scroll = UIScrollView(); scroll.translatesAutoresizingMaskIntoConstraints = false
        content.axis = .vertical; content.spacing = 14; content.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(scroll); scroll.addSubview(content)
        NSLayoutConstraint.activate([
            scroll.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor), scroll.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
            scroll.leadingAnchor.constraint(equalTo: view.leadingAnchor), scroll.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            content.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 16), content.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -16),
            content.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor, constant: 20), content.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor, constant: -20),
            content.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor, constant: -40)
        ])
        veil.backgroundColor = .systemBackground; veil.isHidden = true; veil.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(veil)
        NSLayoutConstraint.activate([veil.topAnchor.constraint(equalTo: view.topAnchor), veil.bottomAnchor.constraint(equalTo: view.bottomAnchor), veil.leadingAnchor.constraint(equalTo: view.leadingAnchor), veil.trailingAnchor.constraint(equalTo: view.trailingAnchor)])
        resume()
    }
    private func label(_ text: String, id: String? = nil) {
        let label = UILabel(); label.text = text; label.numberOfLines = 0
        label.font = .preferredFont(forTextStyle: .body); label.adjustsFontForContentSizeCategory = true
        label.accessibilityIdentifier = id; content.addArrangedSubview(label)
    }
    private func button(_ text: String, id: String, action: @escaping () -> Void) {
        let button = UIButton(type: .system); button.setTitle(text, for: .normal)
        button.titleLabel?.font = .preferredFont(forTextStyle: .body); button.titleLabel?.adjustsFontForContentSizeCategory = true
        button.accessibilityIdentifier = id; button.contentHorizontalAlignment = .leading
        button.addAction(UIAction { _ in action() }, for: .touchUpInside); content.addArrangedSubview(button)
    }
    private func switchRow(_ text: String, id: String, on: Bool, action: @escaping (Bool) -> Void) {
        let row = UIStackView(); row.axis = .horizontal; row.spacing = 12
        let label = UILabel(); label.text = text; label.numberOfLines = 0; label.font = .preferredFont(forTextStyle: .body); label.adjustsFontForContentSizeCategory = true
        let control = UISwitch(); control.isOn = on; control.accessibilityLabel = text; control.accessibilityIdentifier = id
        control.addAction(UIAction { [weak control] _ in if let control { action(control.isOn) } }, for: .valueChanged)
        row.addArrangedSubview(label); row.addArrangedSubview(control); content.addArrangedSubview(row)
    }
    private func render() {
        guard isViewLoaded, let store else { return }
        content.arrangedSubviews.forEach { content.removeArrangedSubview($0); $0.removeFromSuperview() }
        do {
            let document = try store.read()
            label(document.mode == "synthetic-demo" ? "SYNTHETIC DEMO — separate local data" : (document.mode == "historical" ? "Imported history — locally supplied, unverified" : "Personal workspace"), id: "workspace-mode")
            label(status, id: "workspace-status")
            switchRow("Offline reading (no official requests)", id: "offline", on: offline) { [weak self] enabled in
                self?.offline = enabled; if enabled { self?.task?.cancel() }
            }
            label("Damage \(document.totalDamage) · Tokens \(document.totalTokens) · Damage/token \(document.damagePerToken)", id: "analytics")
            if let player = document.player {
                label("Player display: \(player.displayName)\nUpdated \(Date(timeIntervalSince1970: Double(player.upstreamUpdatedAt) / 1000).formatted())\nDisplay confirmation does not prove account ownership.")
                label("Raid tokens \(resource(player.resources.guildRaidTokens)) · Bombs \(resource(player.resources.bombTokens))", id: "resources")
                for unit in player.units { label("\(unit.name) · Rank \(unit.rank) · Level \(unit.xpLevel)", id: "unit-\(unit.id)") }
            }
            button("Add local raid", id: "add-raid") { [weak self] in self?.addRaid() }
            button("Connect Player, Guild and GuildRaid", id: "connect-all") { [weak self] in self?.enterCredential(requestPlayer: true) }
            button("Connect optional Guild / GuildRaid key", id: "connect-optional") { [weak self] in self?.enterCredential(requestPlayer: false) }
            label("Player is required for new personal content. Guild and GuildRaid may be skipped. One key can cover several scopes; separate keys stay in Keychain. Raid-only keys cannot independently bind a guild.")
            for scope in OfficialScope.allCases {
                let capability = try store.capabilities().first(where: { $0.scope == scope })
                label("\(scope.rawValue): \(capability?.status ?? "not connected")", id: "scope-\(scope.rawValue)")
                if let reference = capability?.reference {
                    button("Refresh \(scope.rawValue) key scopes", id: "refresh-\(scope.rawValue)") { [weak self] in self?.connect(credential: nil, reuse: reference, requestPlayer: scope == .player) }
                    button("Disconnect \(scope.rawValue)", id: "disconnect-\(scope.rawValue)") { [weak self] in
                        guard let self, self.requireIdle() else { return }; do { try self.supervisor?.disconnect(scope); self.status = "Disconnected. Previous local data remains readable." } catch { self.status = "Disconnect could not complete." }; self.render()
                    }
                }
            }
            button("Import a workspace JSON", id: "import") { [weak self] in
                guard self?.requireIdle() == true else { return }
                let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.json], asCopy: true); picker.delegate = self; self?.present(picker, animated: true)
            }
            button("Export this workspace JSON", id: "export") { [weak self] in self?.export() }
            label("Import/export uses an explicitly selected file. Exports contain local projections and raid rows, never credentials, Keychain references, verification claims, consent or queued contributions. Imported personal data becomes unverified history.")
            label("Sharing preferences — independent and off by default. Cloud sending requires a reviewed account/guild binding and transport; it is currently unavailable.")
            for purpose in ContributionPurpose.allCases { for dataset in ContributionDataset.allCases {
                let policy = try store.consent(purpose: purpose, dataset: dataset)
                switchRow("\(purpose.rawValue.capitalized) · \(dataset.rawValue)", id: "consent-\(purpose.rawValue)-\(dataset.rawValue)", on: policy.enabled) { [weak self] enabled in
                    do { try self?.store?.setConsent(purpose: purpose, dataset: dataset, enabled: enabled) } catch { self?.status = "Preference could not be saved."; self?.render() }
                }
            } }
            label("Local queued contributions: \(try store.queuedCount()). Changing a preference invalidates its queue generation. No contribution sender is installed.")
        } catch { status = "Protected local data is currently unavailable. Retry after unlocking."; label(status) }
    }
    private func resource(_ token: TokenSnapshot?) -> String { token.map { "\($0.current)/\($0.max)" } ?? "unavailable" }
    private func requireIdle() -> Bool {
        guard task == nil else { status = "Wait for the current scope request before changing workspace data."; render(); return false }
        return true
    }
    func suspend() {
        secureField?.text = nil; secureField = nil
        task?.cancel(); task = nil
        finishConfirmation(false)
        dismiss(animated: false); veil.isHidden = false
        store?.close(); cleanupExport()
    }
    func resume() {
        guard isViewLoaded, UIApplication.shared.isProtectedDataAvailable else { return }
        do {
            if let store { try store.open() }
            else {
                let store = try WorkspaceStore(url: WorkspaceStore.applicationURL(demo: demo))
                self.store = store
                if demo { if (try store.read()).player == nil { try store.write(.demo) } }
                supervisor = ConnectionSupervisor(store: store, vault: vault, source: DeviceOfficialSource())
            }
            if !demo, let store { try vault.removeOrphans(keeping: Set(try store.capabilities().compactMap(\.reference))) }
            veil.isHidden = true; render()
        } catch { veil.isHidden = true; label("Workspace could not be opened. Your existing file has been retained.") }
    }
    private func enterCredential(requestPlayer: Bool) {
        guard !offline else { status = "Disable offline reading to request official scopes."; render(); return }
        let prompt = UIAlertController(title: "Official API key", message: "Read scopes are requested only from the fixed official API. Player confirmation is mandatory for personal content.", preferredStyle: .alert)
        prompt.addTextField { [weak self] field in self?.secureField = field; field.isSecureTextEntry = true; field.textContentType = .password; field.autocapitalizationType = .none; field.autocorrectionType = .no; field.accessibilityIdentifier = "secure-official-key" }
        prompt.addAction(UIAlertAction(title: "Skip", style: .cancel) { [weak prompt] _ in prompt?.textFields?.first?.text = nil })
        prompt.addAction(UIAlertAction(title: "Request scopes", style: .default) { [weak self, weak prompt] _ in
            let credential = prompt?.textFields?.first?.text ?? ""; prompt?.textFields?.first?.text = nil
            self?.connect(credential: credential, requestPlayer: requestPlayer)
        }); present(prompt, animated: true)
    }
    private func connect(credential: String?, reuse: String? = nil, requestPlayer: Bool) {
        guard !offline, task == nil, let supervisor else { status = "Official requests are unavailable while offline or busy."; render(); return }
        task = Task { [weak self] in
            guard let self else { return }
            defer { self.task = nil }
            do {
                try await supervisor.connect(credential: credential, reuse: reuse, requestPlayer: requestPlayer) { [weak self] display, previous in
                    guard let self, !Task.isCancelled else { return false }
                    return await self.confirm(display: display, previous: previous)
                }
                self.status = "Available scopes saved. Optional failures stay visible; local history remains readable."
            } catch { self.status = "Scopes could not all be verified. Player remains required; previous local data is retained." }
            if !Task.isCancelled { self.render() }
        }
    }
    private var confirmation: CheckedContinuation<Bool, Never>?
    private func confirm(display: String, previous: String?) async -> Bool {
        await withCheckedContinuation { continuation in
            confirmation = continuation
            let message = "Use displayed Player \(display)?" + (previous.map { " Previous display: \($0)." } ?? "") + " This confirms a display, not stable account ownership."
            let prompt = UIAlertController(title: "Confirm Player display", message: message, preferredStyle: .alert)
            prompt.addAction(UIAlertAction(title: "Cancel", style: .cancel) { [weak self] _ in self?.finishConfirmation(false) })
            prompt.addAction(UIAlertAction(title: "Confirm", style: .default) { [weak self] _ in self?.finishConfirmation(true) })
            present(prompt, animated: true)
        }
    }
    private func finishConfirmation(_ confirmed: Bool) { let pending = confirmation; confirmation = nil; pending?.resume(returning: confirmed) }
    private func addRaid() {
        guard requireIdle() else { return }
        guard let store else { return }
        do { let document = try store.read(); guard document.mode != "personal" || document.player != nil else { status = "Verify Player before creating personal content."; render(); return } } catch { return }
        let prompt = UIAlertController(title: "Local raid row", message: "User-supplied, unverified. Integer damage and tokens are calculated offline.", preferredStyle: .alert)
        for (placeholder, id) in [("Player display", "raid-player"), ("Boss", "raid-boss"), ("Damage", "raid-damage"), ("Tokens 1–100", "raid-tokens")] {
            prompt.addTextField { $0.placeholder = placeholder; $0.accessibilityIdentifier = id; if id == "raid-damage" || id == "raid-tokens" { $0.keyboardType = .numberPad } }
        }
        prompt.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        prompt.addAction(UIAlertAction(title: "Save local row", style: .default) { [weak self, weak prompt] _ in
            guard let self, let fields = prompt?.textFields, fields.count == 4,
                  let damage = Int64(fields[2].text ?? ""), let tokens = Int64(fields[3].text ?? "") else { return }
            do { try store.add(RaidRow(player: fields[0].text ?? "", boss: fields[1].text ?? "", damage: damage, tokens: tokens, observedAt: Int64(Date().timeIntervalSince1970 * 1000))); self.status = "Local row saved." }
            catch { self.status = "Row rejected. Existing data retained." }; self.render()
        }); present(prompt, animated: true)
    }
    private func export() {
        guard requireIdle() else { return }
        guard let store else { return }
        do {
            cleanupExport()
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("workspace-\(UUID().uuidString).json")
            try store.exportDocument().write(to: url, options: [.atomic, .completeFileProtection])
            var excluded = url; var values = URLResourceValues(); values.isExcludedFromBackup = true; try excluded.setResourceValues(values)
            temporaryExport = url
            let picker = UIDocumentPickerViewController(forExporting: [url], asCopy: true); picker.delegate = self; present(picker, animated: true)
        } catch { status = "Export could not be prepared."; render() }
    }
    private func cleanupExport() { if let temporaryExport { try? FileManager.default.removeItem(at: temporaryExport) }; temporaryExport = nil }
    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { cleanupExport() }
    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        if temporaryExport != nil { cleanupExport(); return }
        guard let url = urls.first, let store else { return }
        let access = url.startAccessingSecurityScopedResource(); defer { if access { url.stopAccessingSecurityScopedResource() } }
        do {
            let handle = try FileHandle(forReadingFrom: url); defer { try? handle.close() }
            let data = try handle.read(upToCount: 1_048_577) ?? Data()
            let old = try store.capabilities()
            try store.importDocument(data)
            // The import is committed; key cleanup is best-effort and reported separately.
            var leftover = 0
            for ref in Set(old.compactMap(\.reference)) { do { try vault.remove(ref) } catch { leftover += 1 } }
            status = "Imported as unverified local history. Sharing is off and keys disconnected."
                + (leftover > 0 ? " Some stored keys could not be removed from this device; they are no longer used." : "")
        } catch { status = "Import rejected. Existing workspace is retained." }
        render()
    }
}
