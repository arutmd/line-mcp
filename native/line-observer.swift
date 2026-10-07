import Cocoa
import ApplicationServices
import Foundation

let _ = NSApplication.shared
setbuf(stdout, nil)

class LineBackgroundObserver {
    private var isRunning = true
    private var seenNotificationHashes = Set<String>()
    private let lineBundleId = "jp.naver.line.mac"
    private let ncBundleId = "com.apple.notificationcenterui"
    private let ingestUrl = URL(string: "http://localhost:3741/api/ingest")!

    func start() {
        print("🟢 LINE True Background Observer started.")
        print("   • True background: Catches incoming LINE messages even when LINE is minimized/in Dock!")
        print("   • Lifecycle bound: Automatically pauses when LINE is quit.")
        print("   • Zero manual copying required.\n")

        Task {
            while isRunning {
                await self.tick()
                try? await Task.sleep(nanoseconds: 1_000_000_000) // check every 1s
            }
        }
    }

    private func tick() async {
        // 1. Check if LINE process is running
        let lineApps = NSRunningApplication.runningApplications(withBundleIdentifier: lineBundleId)
        guard !lineApps.isEmpty else {
            // LINE not running -> Sleep quietly
            return
        }

        // 2. Query NotificationCenter UI tree
        guard let ncApp = NSRunningApplication.runningApplications(withBundleIdentifier: ncBundleId).first else {
            return
        }

        let appElem = AXUIElementCreateApplication(ncApp.processIdentifier)
        var winVal: AnyObject?
        guard AXUIElementCopyAttributeValue(appElem, kAXWindowsAttribute as CFString, &winVal) == .success,
              let windows = winVal as? [AXUIElement], !windows.isEmpty else {
            return
        }

        // 3. Scan for LINE notification banners
        for win in windows {
            self.scanElement(win)
        }
    }

    private func scanElement(_ elem: AXUIElement) {
        var descVal: AnyObject?
        AXUIElementCopyAttributeValue(elem, kAXDescriptionAttribute as CFString, &descVal)
        var titleVal: AnyObject?
        AXUIElementCopyAttributeValue(elem, kAXTitleAttribute as CFString, &titleVal)
        var valVal: AnyObject?
        AXUIElementCopyAttributeValue(elem, kAXValueAttribute as CFString, &valVal)

        let desc = descVal as? String ?? ""
        let title = titleVal as? String ?? ""
        let value = valVal as? String ?? ""

        // Check if any attribute indicates LINE
        let combined = [desc, title, value].filter { !$0.isEmpty }.joined(separator: "\n")
        if combined.contains("LINE") || combined.contains("ไลน์") {
            self.processNotificationText(combined)
        }

        // Recursively inspect children
        var childrenVal: AnyObject?
        if AXUIElementCopyAttributeValue(elem, kAXChildrenAttribute as CFString, &childrenVal) == .success,
           let children = childrenVal as? [AXUIElement] {
            for c in children {
                scanElement(c)
            }
        }
    }

    private func processNotificationText(_ text: String) {
        // Example banner formats from LINE:
        // "LINE\nพี่สมชาย: รบกวนช่วยดูไฟล์สรุปงบให้หน่อยครับ"
        // "LINE\n[Demo Operations]\nน้องนนท์: รบกวนเคาะตัวเลข budget ให้ก่อน 5 โมงครับ"

        let hash = String(text.hashValue)
        if seenNotificationHashes.contains(hash) {
            return
        }
        seenNotificationHashes.insert(hash)

        // Parse sender, group, and message
        let lines = text.split(separator: "\n").map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
        var groupName = "LINE Chat"
        var sender = "LINE Contact"
        var messageBody = ""

        for line in lines {
            if line == "LINE" || line == "Notification Center" { continue }

            // Check for [Group Name]
            if line.hasPrefix("[") && line.contains("]") {
                let parts = line.split(separator: "]", maxSplits: 1)
                groupName = String(parts[0].dropFirst()).trimmingCharacters(in: .whitespaces)
                if parts.count > 1 {
                    let rest = String(parts[1]).trimmingCharacters(in: .whitespaces)
                    if rest.contains(":") {
                        let sub = rest.split(separator: ":", maxSplits: 1)
                        sender = String(sub[0]).trimmingCharacters(in: .whitespaces)
                        messageBody = String(sub[1]).trimmingCharacters(in: .whitespaces)
                    } else {
                        messageBody = rest
                    }
                }
            } else if line.contains(":") && messageBody.isEmpty {
                let sub = line.split(separator: ":", maxSplits: 1)
                sender = String(sub[0]).trimmingCharacters(in: .whitespaces)
                messageBody = String(sub[1]).trimmingCharacters(in: .whitespaces)
            } else if messageBody.isEmpty {
                messageBody = line
            }
        }

        if messageBody.count < 4 { return }

        print("\n📬 [Background LINE Notification Detected]")
        print("   Group:  [\(groupName)]")
        print("   Sender: \(sender)")
        print("   Text:   \"\(messageBody)\"")

        Task {
            await self.sendToIngest(text: messageBody, sender: sender, groupName: groupName)
        }
    }

    private func sendToIngest(text: String, sender: String, groupName: String) async {
        var req = URLRequest(url: ingestUrl)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let payload: [String: Any] = [
            "text": text,
            "sender": sender,
            "groupName": groupName
        ]

        guard let data = try? JSONSerialization.data(withJSONObject: payload) else { return }
        req.httpBody = data

        do {
            let (resData, res) = try await URLSession.shared.data(for: req)
            if let httpRes = res as? HTTPURLResponse, httpRes.statusCode == 200 {
                if let json = try? JSONSerialization.jsonObject(with: resData) as? [String: Any],
                   let captured = json["captured"] as? Bool, captured {
                    print("   ✨ Successfully captured task in background!")
                }
            }
        } catch {
            // Server offline
        }
    }
}

let observer = LineBackgroundObserver()
observer.start()

RunLoop.main.run()
