import Foundation
import Security
import CryptoKit

enum StoreError: Error { case invalid, unavailable }
func key(_ service: String, create: Bool) throws -> SymmetricKey {
    let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: service, kSecAttrAccount as String: "codex-own",
        kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    if status == errSecSuccess, let data = item as? Data, data.count == 32 {
        return SymmetricKey(data: data)
    }
    guard create && status == errSecItemNotFound else { throw StoreError.unavailable }
    var data = Data(count: 32)
    guard data.withUnsafeMutableBytes({ SecRandomCopyBytes(kSecRandomDefault, 32, $0.baseAddress!) }) == errSecSuccess else { throw StoreError.unavailable }
    let add: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: service, kSecAttrAccount as String: "codex-own",
        kSecAttrLabel as String: "codex-own 模型凭据", kSecValueData as String: data]
    let added = SecItemAdd(add as CFDictionary, nil)
    if added == errSecDuplicateItem { return try key(service, create: false) }
    guard added == errSecSuccess else { throw StoreError.unavailable }
    return SymmetricKey(data: data)
}
do {
    guard CommandLine.arguments.count == 3 else { throw StoreError.invalid }
    let mode = CommandLine.arguments[1], service = CommandLine.arguments[2]
    guard ["encrypt", "decrypt"].contains(mode), service.hasPrefix("codex-own.credentials."), service.count < 160 else { throw StoreError.invalid }
    let input = FileHandle.standardInput.readDataToEndOfFile()
    guard input.count <= 2 * 1024 * 1024 else { throw StoreError.invalid }
    let secret = try key(service, create: mode == "encrypt")
    let output: Data
    if mode == "encrypt" {
        guard let combined = try AES.GCM.seal(input, using: secret).combined else { throw StoreError.invalid }
        output = combined
    } else {
        output = try AES.GCM.open(AES.GCM.SealedBox(combined: input), using: secret)
    }
    FileHandle.standardOutput.write(output)
} catch {
    FileHandle.standardError.write(Data("OS_CREDENTIAL_STORE_UNAVAILABLE\n".utf8))
    exit(1)
}
