// Experimental AX-only backend. No application activation, clipboard or keyboard events.
import Cocoa
import ApplicationServices

struct Selector: Codable { let role: String; let identifier: String }
struct Profile: Codable {
    let wechatVersion: String
    let conversationList: Selector
    let conversationRow: Selector
    let header: Selector
    let composer: Selector
    let sendButton: Selector
}
struct Request: Codable {
    let action: String
    let name: String?
    let text: String?
    let profile: Profile?
}
struct Failure: Error { let reason: String; let detail: String }
func fail(_ reason: String, _ detail: String) throws -> Never { throw Failure(reason: reason, detail: detail) }
func value(_ node: AXUIElement, _ name: String) -> CFTypeRef? {
    var result: CFTypeRef?
    return AXUIElementCopyAttributeValue(node, name as CFString, &result) == .success ? result : nil
}
func string(_ node: AXUIElement, _ name: String) -> String { value(node, name) as? String ?? "" }
func actions(_ node: AXUIElement) -> [String] {
    var result: CFArray?
    return AXUIElementCopyActionNames(node, &result) == .success ? (result as? [String] ?? []) : []
}
func writable(_ node: AXUIElement) -> Bool {
    var result: DarwinBoolean = false
    return AXUIElementIsAttributeSettable(node, "AXValue" as CFString, &result) == .success && result.boolValue
}
func nodes(_ root: AXUIElement) throws -> [AXUIElement] {
    var result: [AXUIElement] = []
    var pending: [(AXUIElement, Int)] = [(root, 0)]
    while let (node, depth) = pending.popLast() {
        if result.contains(where: { CFEqual($0, node) }) { continue }
        if result.count >= 2000 || depth > 30 { try fail("unsupported", "控件树超出探测范围") }
        result.append(node)
        for child in value(node, "AXChildren") as? [AXUIElement] ?? [] { pending.append((child, depth + 1)) }
    }
    return result
}
func matches(_ node: AXUIElement, _ selector: Selector) -> Bool {
    !selector.identifier.isEmpty && string(node, "AXRole") == selector.role && string(node, "AXIdentifier") == selector.identifier
}
func unique(_ all: [AXUIElement], _ selector: Selector) throws -> AXUIElement {
    let found = all.filter { matches($0, selector) }
    guard found.count == 1 else { try fail("unsupported", "无法唯一识别控件：\(selector.role)/\(selector.identifier)") }
    return found[0]
}
func label(_ node: AXUIElement, equals expected: String) -> Bool {
    // Exact equality only; never select the first search result or use substring matching.
    ["AXTitle", "AXValue"].contains { string(node, $0) == expected }
}
func press(_ node: AXUIElement) throws {
    guard actions(node).contains("AXPress"), (value(node, "AXEnabled") as? Bool) == true else {
        try fail("unsupported", "控件不支持可用的 AXPress 操作")
    }
    guard AXUIElementPerformAction(node, "AXPress" as CFString) == .success else { try fail("unsupported", "AXPress 操作失败") }
}
func setText(_ node: AXUIElement, _ text: String) throws {
    guard writable(node) else { try fail("unsupported", "输入框不支持后台写入") }
    guard AXUIElementSetAttributeValue(node, "AXValue" as CFString, text as CFString) == .success else {
        try fail("unsupported", "输入框后台写入失败")
    }
}
func run(_ req: Request) throws -> [String: Any] {
    guard AXIsProcessTrusted() else { try fail("no-permission", "未授予辅助功能权限") }
    let apps = NSRunningApplication.runningApplications(withBundleIdentifier: "com.tencent.xinWeChat")
    guard apps.count == 1, let app = apps.first else { try fail("no-window", "未找到唯一微信进程") }
    let root = AXUIElementCreateApplication(app.processIdentifier)
    AXUIElementSetMessagingTimeout(root, 1)
    let all = try nodes(root)
    if req.action == "inspect" {
        // Deliberately omit titles, values and descriptions: diagnostics contain no chat text.
        let rows: [[String: Any]] = all.map { node in
            ["role": string(node, "AXRole"), "identifier": string(node, "AXIdentifier"),
             "actions": actions(node), "valueSettable": writable(node)]
        }
        return ["ok": true, "active": app.isActive, "version": app.bundleURL.flatMap { Bundle(url: $0)?.infoDictionary?["CFBundleShortVersionString"] as? String } ?? "unknown", "nodes": rows]
    }
    guard let profile = req.profile, let name = req.name, !name.isEmpty else { try fail("unsupported", "缺少已验证的控件配置或会话名") }
    guard let bundleURL = app.bundleURL, Bundle(url: bundleURL)?.infoDictionary?["CFBundleShortVersionString"] as? String == profile.wechatVersion else { try fail("unsupported", "微信版本与控件配置不一致") }
    let foregroundPid = NSWorkspace.shared.frontmostApplication?.processIdentifier
    func idle() throws {
        guard !app.isActive, NSWorkspace.shared.frontmostApplication?.processIdentifier == foregroundPid else {
            try fail("busy", "用户正在使用微信或前台应用已变化")
        }
    }
    func current() throws -> [AXUIElement] {
        try idle()
        let fresh = try nodes(root)
        guard label(try unique(fresh, profile.header), equals: name) else { try fail("unsupported", "当前会话与目标不一致") }
        return fresh
    }
    try idle()
    if req.action == "select" {
        let list = try unique(all, profile.conversationList)
        let rows = try nodes(list).filter { matches($0, profile.conversationRow) }
        var candidates: [AXUIElement] = []
        for row in rows {
            if try nodes(row).contains(where: { label($0, equals: name) }) { candidates.append(row) }
        }
        guard candidates.count == 1 else { try fail("unsupported", "目标必须唯一且已出现在会话列表中") }
        try idle()
        try press(candidates[0])
        for _ in 0..<10 {
            Thread.sleep(forTimeInterval: 0.1)
            try idle()
            if let header = try? unique(nodes(root), profile.header), label(header, equals: name) { return ["ok": true] }
        }
        try fail("unsupported", "后台会话切换未得到确认")
    }
    guard let text = req.text, !text.isEmpty else { try fail("unsupported", "缺少待发送文本") }
    let fresh = try current()
    let composer = try unique(fresh, profile.composer)
    guard let existing = value(composer, "AXValue") as? String else { try fail("unsupported", "无法读取输入框内容") }
    if req.action == "fill" {
        guard existing.isEmpty else { try fail("unsupported", "输入框已有草稿，已停止以免覆盖") }
        // Verify capability before placing a draft, including the send button.
        let button = try unique(fresh, profile.sendButton)
        guard actions(button).contains("AXPress") else { try fail("unsupported", "发送按钮不支持后台操作") }
        try idle()
        try setText(composer, text)
        _ = try current()
        guard string(composer, "AXValue") == text else { try fail("unsupported", "输入框内容校验失败") }
        return ["ok": true]
    }
    if req.action == "commit" {
        if existing.isEmpty { return ["ok": true] } // Idempotent after a successful send.
        guard existing == text else { try fail("unsupported", "草稿已变化，已停止发送") }
        let button = try unique(fresh, profile.sendButton)
        _ = try current()
        guard string(composer, "AXValue") == text else { try fail("unsupported", "发送前草稿已变化") }
        try idle()
        try press(button)
        return ["ok": true]
    }
    try fail("unsupported", "未知操作")
}
do {
    let req = try JSONDecoder().decode(Request.self, from: FileHandle.standardInput.readDataToEndOfFile())
    let result = try run(req)
    let data = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
    print(String(decoding: data, as: UTF8.self))
} catch {
    let failure = error as? Failure ?? Failure(reason: "unsupported", detail: "后台控件请求无效")
    let result: [String: Any] = ["ok": false, "reason": failure.reason, "detail": failure.detail]
    let data = try! JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
    print(String(decoding: data, as: UTF8.self))
}
