import AppKit
import Foundation
import Security

struct Request: Decodable {
    let operation: String
    let handle: String
    let label: String?
    let value: String?
}

func finish(_ status: String, _ value: String? = nil, errorCode: OSStatus? = nil) -> Never {
    var response = ["status": status]
    if let value { response["value"] = value }
    if ProcessInfo.processInfo.arguments.contains("--synthetic-test"), let errorCode { response["errorCode"] = String(errorCode) }
    let bytes = try! JSONSerialization.data(withJSONObject: response)
    FileHandle.standardOutput.write(bytes)
    exit(status == "ok" ? 0 : 1)
}

let input = FileHandle.standardInput.readDataToEndOfFile()
guard input.count <= 16384,
      let request = try? JSONDecoder().decode(Request.self, from: input),
      request.handle.range(of: "^[a-z0-9-]{1,80}$", options: .regularExpression) != nil
else { finish("invalid-request") }

let service = "com.tacticusanalytics.desktop.official-read.v1"
var query: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: service,
    kSecAttrAccount as String: request.handle,
    kSecAttrSynchronizable as String: false
]
// Reads do not open an authentication prompt behind the user's current action.
query[kSecUseAuthenticationUI as String] = kSecUseAuthenticationUIFail
let arguments = ProcessInfo.processInfo.arguments
if arguments.contains("--synthetic-test"), let index = arguments.firstIndex(of: "--synthetic-keychain"), index + 1 < arguments.count {
    var keychain: SecKeychain?
    guard SecKeychainOpen(arguments[index + 1], &keychain) == errSecSuccess, let keychain else { finish("vault-unavailable") }
    query[kSecUseKeychain as String] = keychain
    query[kSecMatchSearchList as String] = [keychain]
} else {
    // Production uses the data protection Keychain. Missing owner-provided
    // signing/provisioning access must fail closed, never use a file fallback.
    query[kSecUseDataProtectionKeychain as String] = true
}

func store(_ value: String) {
    guard !value.isEmpty, value.utf8.count <= 8192 else { finish("invalid-secret") }
    let bytes = Data(value.utf8)
    var add = query
    add.removeValue(forKey: kSecUseAuthenticationUI as String)
    add.removeValue(forKey: kSecMatchSearchList as String)
    add[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
    add[kSecValueData as String] = bytes
    let result = SecItemAdd(add as CFDictionary, nil)
    if result != errSecSuccess { finish("vault-unavailable", errorCode: result) }
    finish("ok")
}

switch request.operation {
case "prompt-store":
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    app.activate(ignoringOtherApps: true)
    let alert = NSAlert()
    alert.messageText = "Connect official game access"
    alert.informativeText = request.label ?? "Player access is required. Guild and Guild Raid access unlock additional features."
    alert.addButton(withTitle: "Connect")
    alert.addButton(withTitle: "Cancel")
    let field = NSSecureTextField(frame: NSRect(x: 0, y: 0, width: 420, height: 28))
    field.placeholderString = "Official API key"
    alert.accessoryView = field
    alert.window.initialFirstResponder = field
    guard alert.runModal() == .alertFirstButtonReturn else { finish("cancelled") }
    let value = field.stringValue
    field.stringValue = ""
    store(value)
case "confirm-player":
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    app.activate(ignoringOtherApps: true)
    let alert = NSAlert()
    alert.messageText = "Confirm your Player workspace"
    alert.informativeText = "Player name: \(request.label ?? "Unavailable"). This confirms the displayed account, not account ownership. Cloud contribution remains off."
    alert.addButton(withTitle: "Use this Player")
    alert.addButton(withTitle: "Cancel")
    finish(alert.runModal() == .alertFirstButtonReturn ? "ok" : "cancelled")
case "store-fixture":
    // Only an explicit developer test invocation can supply synthetic input.
    guard ProcessInfo.processInfo.arguments.contains("--synthetic-test"),
          let value = request.value, value.hasPrefix("SYNTHETIC-CANARY-") else { finish("invalid-request") }
    store(value)
case "read":
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    guard status == errSecSuccess, let bytes = result as? Data,
          let value = String(data: bytes, encoding: .utf8) else { finish("vault-unavailable", errorCode: status) }
    finish("ok", value)
case "remove":
    let status = SecItemDelete(query as CFDictionary)
    finish(status == errSecSuccess || status == errSecItemNotFound ? "ok" : "vault-unavailable")
default: finish("invalid-request")
}
