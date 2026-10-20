import Cocoa

final class Installer: NSObject, NSApplicationDelegate, NSWindowDelegate {
    var window: NSWindow!
    let status = NSTextField(wrappingLabelWithString: "完整安装包包含桌面应用及独立 Node、npm、Python。请预留至少 10 GB 可用空间，安装前完全退出 codex-own。")
    let selected = NSTextField(wrappingLabelWithString: "API 配置文件：尚未选择（可选）")
    let log = NSTextView()
    let install = NSButton(title: "安装 codex-own", target: nil, action: nil)
    let choose = NSButton(title: "选择 API 配置 txt…", target: nil, action: nil)
    let open = NSButton(title: "打开 codex-own", target: nil, action: nil)
    var key: URL?
    var running = false
    let lock = NSLock()
    var pending = Data()

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        window = NSWindow(contentRect: NSRect(x: 0,y: 0,width: 680,height: 500),styleMask: [.titled,.closable,.miniaturizable],backing: .buffered,defer: false)
        window.title = "codex-own 安装器"
        window.delegate = self
        window.center()
        let content = window.contentView!
        let title = NSTextField(labelWithString: "安装 codex-own")
        title.font = .boldSystemFont(ofSize: 23)
        title.frame = NSRect(x: 28,y: 442,width: 620,height: 32)
        status.frame = NSRect(x: 28,y: 370,width: 620,height: 65)
        selected.frame = NSRect(x: 28,y: 303,width: 620,height: 30)
        choose.frame = NSRect(x: 28,y: 337,width: 210,height: 30)
        choose.target = self; choose.action = #selector(pick)
        let scroll = NSScrollView(frame: NSRect(x: 28,y: 78,width: 624,height: 215))
        scroll.hasVerticalScroller = true; scroll.borderType = .bezelBorder
        log.isEditable = false; log.font = .monospacedSystemFont(ofSize: 12,weight: .regular)
        scroll.documentView = log
        install.frame = NSRect(x: 28,y: 24,width: 190,height: 34)
        install.target = self; install.action = #selector(start)
        open.frame = NSRect(x: 440,y: 24,width: 210,height: 34)
        open.target = self; open.action = #selector(openApp); open.isEnabled = false
        for view in [title,status,selected,choose,scroll,install,open] { content.addSubview(view) }
        window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
    }
    @objc func pick() {
        let panel = NSOpenPanel(); panel.canChooseDirectories = false; panel.allowsMultipleSelection = false
        panel.message = "请选择你保存的 API 密钥 txt 文件。路径取决于自己的下载位置。文件仅用于本机配置。"
        if panel.runModal() == .OK { key = panel.url; selected.stringValue = "API 配置文件：" + (key?.path ?? "尚未选择") }
    }
    func append(_ bytes: Data) {
        lock.lock(); pending.append(bytes)
        var lines: [String] = []
        while let at = pending.firstIndex(of: 10) {
            lines.append(String(decoding: pending[..<at],as: UTF8.self)); pending.removeSubrange(...at)
        }
        lock.unlock()
        DispatchQueue.main.async {
            for line in lines { self.log.textStorage?.append(NSAttributedString(string: line + "\n")) }
            self.log.scrollToEndOfDocument(nil)
        }
    }
    @objc func start() {
        guard !running, let root = Bundle.main.resourceURL else { return }
        running = true; install.isEnabled = false; choose.isEnabled = false; open.isEnabled = false
        status.stringValue = "正在校验并安装完整资源，请耐心等待。安装结束前请保持此窗口打开。"
        let process = Process(); process.executableURL = root.appendingPathComponent("engine/node")
        process.arguments = [root.appendingPathComponent("offline-install.mjs").path]
        if let key = key { process.arguments! += ["--api-key-file",key.path] }
        var env = ProcessInfo.processInfo.environment
        for name in ["NODE_OPTIONS","NODE_PATH","ELECTRON_RUN_AS_NODE"] { env.removeValue(forKey: name) }
        process.environment = env
        let pipe = Pipe(); process.standardOutput = pipe; process.standardError = pipe
        pipe.fileHandleForReading.readabilityHandler = { handle in let data = handle.availableData; if !data.isEmpty { self.append(data) } }
        process.terminationHandler = { child in
            pipe.fileHandleForReading.readabilityHandler = nil
            let remaining = pipe.fileHandleForReading.readDataToEndOfFile(); if !remaining.isEmpty { self.append(remaining) }
            DispatchQueue.main.async {
                self.running = false; self.install.isEnabled = true; self.choose.isEnabled = true
                if child.terminationStatus == 0 {
                    self.status.stringValue = "安装完成。可从“应用程序”打开 codex-own，后续使用应用内“更新”菜单。未导入 API 配置时，可退出应用后重新运行安装器导入。"
                    self.open.isEnabled = true
                } else {
                    self.status.stringValue = "安装未完成，请查看下方说明。现有安装及恢复材料会保留；请退出应用、检查空间和目录权限后重试。"
                }
            }
        }
        do { try process.run() } catch {
            running = false; install.isEnabled = true; choose.isEnabled = true
            status.stringValue = "无法启动安装引擎：" + error.localizedDescription
        }
    }
    @objc func openApp() { NSWorkspace.shared.open(URL(fileURLWithPath: "/Applications/codex-own.app")) }
    func windowShouldClose(_ sender: NSWindow) -> Bool { return !running }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { return true }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply { return running ? .terminateCancel : .terminateNow }
}
let app = NSApplication.shared
let installer = Installer()
app.delegate = installer
app.run()
