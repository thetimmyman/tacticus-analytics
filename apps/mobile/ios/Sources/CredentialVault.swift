import Foundation
import Security

protocol OfficialCredentialVault {
    func save(_ credential: String) throws -> String
    func withOfficialRead(_ reference: String, operation: (String) async throws -> Data) async throws -> Data
    func remove(_ reference: String) throws
}
final class CredentialVault: OfficialCredentialVault {
    private let service = "com.tacticusanalytics.mobile.ios.official-read"
    private func query(_ reference: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
         kSecAttrAccount as String: reference, kSecAttrSynchronizable as String: false]
    }
    func save(_ credential: String) throws -> String {
        guard !credential.isEmpty, credential.utf8.count <= 1024, !credential.contains("\n"), !credential.contains("\r") else { throw WorkspaceError.credential }
        let reference = UUID().uuidString
        var item = query(reference)
        item[kSecValueData as String] = Data(credential.utf8)
        item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else { throw WorkspaceError.credential }
        return reference
    }
    func withOfficialRead(_ reference: String, operation: (String) async throws -> Data) async throws -> Data {
        var item = query(reference)
        item[kSecReturnData as String] = true
        item[kSecMatchLimit as String] = kSecMatchLimitOne
        var value: CFTypeRef?
        guard SecItemCopyMatching(item as CFDictionary, &value) == errSecSuccess,
              let data = value as? Data, let credential = String(data: data, encoding: .utf8) else { throw WorkspaceError.credential }
        return try await operation(credential)
    }
    func remove(_ reference: String) throws {
        let status = SecItemDelete(query(reference) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw WorkspaceError.credential }
    }
}

enum SecretGuard {
    static func check(_ data: Data, credential: String) throws {
        let text = String(decoding: data, as: UTF8.self)
        let bytes = Data(credential.utf8)
        var variants = [credential, bytes.base64EncodedString(), bytes.map { String(format: "%02x", $0) }.joined(),
                        bytes.map { String(format: "%%%02X", $0) }.joined(),
                        credential.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? credential]
        variants += variants.map { Data($0.utf8).base64EncodedString() }
        guard !variants.contains(where: { !$0.isEmpty && text.contains($0) }) else { throw WorkspaceError.credential }
    }
}
