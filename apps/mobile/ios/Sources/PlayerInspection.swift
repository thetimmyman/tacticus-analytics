import UIKit

// Native drilldown keeps large canonical arrays bounded on phone and tablet.
final class PlayerInspectionController: UIViewController {
    private let node: Any
    private var page = 0
    private let stack = UIStackView()
    init(title: String, node: Any) { self.node = node; super.init(nibName: nil, bundle: nil); self.title = title }
    required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }
    override func viewDidLoad() {
        super.viewDidLoad(); view.backgroundColor = .systemBackground
        navigationItem.rightBarButtonItem = UIBarButtonItem(title: "Close snapshot", style: .done, target: self, action: #selector(close))
        let scroll = UIScrollView(); scroll.translatesAutoresizingMaskIntoConstraints = false; view.addSubview(scroll)
        stack.axis = .vertical; stack.spacing = 12; stack.translatesAutoresizingMaskIntoConstraints = false; scroll.addSubview(stack)
        NSLayoutConstraint.activate([
            scroll.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor), scroll.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
            scroll.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16), scroll.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
            stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 12), stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -12),
            stack.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor), stack.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor),
            stack.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor)
        ]); render()
    }
    @objc private func close() { dismiss(animated: true) }
    private func button(_ title: String, id: String, action: @escaping () -> Void) {
        let button = UIButton(type: .system); button.setTitle(title, for: .normal)
        button.titleLabel?.font = .preferredFont(forTextStyle: .body); button.titleLabel?.adjustsFontForContentSizeCategory = true
        button.titleLabel?.numberOfLines = 0; button.accessibilityIdentifier = id
        button.addAction(UIAction { _ in action() }, for: .touchUpInside); stack.addArrangedSubview(button)
    }
    private func render() {
        for view in stack.arrangedSubviews { stack.removeArrangedSubview(view); view.removeFromSuperview() }
        let entries: [(String, Any)]
        if let object = node as? [String: Any] { entries = object.keys.sorted().map { ($0, object[$0]!) } }
        else if let array = node as? [Any] { entries = array.enumerated().map { (String($0.offset), $0.element) } }
        else { entries = [("Value", node)] }
        let start = page * 50, end = min(entries.count, start + 50)
        let heading = UILabel(); heading.numberOfLines = 0; heading.font = .preferredFont(forTextStyle: .body)
        heading.adjustsFontForContentSizeCategory = true; heading.text = "Cached Player data · \(entries.count) entries. Offline readable; no ownership or current-scope claim."
        heading.accessibilityIdentifier = "snapshot-summary"; stack.addArrangedSubview(heading)
        for (key, value) in entries[start..<end] {
            if value is [String: Any] || value is [Any] {
                let item = value as? [String: Any]
                let name = item?["name"] as? String ?? item?["id"] as? String
                button(name.map { "\(key): \($0)" } ?? key, id: "snapshot-\(key)") { [weak self] in
                    self?.navigationController?.pushViewController(PlayerInspectionController(title: name ?? key, node: value), animated: true)
                }
            } else {
                let label = UILabel(); label.numberOfLines = 0; label.font = .preferredFont(forTextStyle: .body)
                label.adjustsFontForContentSizeCategory = true; label.text = "\(key): \(value)"; label.accessibilityIdentifier = "snapshot-value-\(key)"; stack.addArrangedSubview(label)
            }
        }
        if page > 0 { button("Previous 50", id: "snapshot-previous") { [weak self] in self?.page -= 1; self?.render() } }
        if end < entries.count { button("Next 50", id: "snapshot-next") { [weak self] in self?.page += 1; self?.render() } }
    }
}
