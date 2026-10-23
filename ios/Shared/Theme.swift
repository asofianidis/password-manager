import PMCore
import SwiftUI

/** The desktop app's graphite theme (src/renderer/src/assets/main.css), as on Android. */
enum Palette {
    static let canvas = Color(hex: 0x0A0B0A)
    static let panel = Color(hex: 0x111311)
    static let raised = Color(hex: 0x171A17)
    static let line = Color(hex: 0x20241F)
    static let lineStrong = Color(hex: 0x2D322C)
    static let bright = Color(hex: 0xEEF1EA)
    static let fg = Color(hex: 0xC3C8BE)
    static let muted = Color(hex: 0x858C81)
    static let faint = Color(hex: 0x50564D)
    static let accent = Color(hex: 0xC4F042)
    static let accentFg = Color(hex: 0x11160A)
    static let danger = Color(hex: 0xFF6E61)
    static let warn = Color(hex: 0xF2B84B)
    static let ok = Color(hex: 0x4FD99B)
    static let info = Color(hex: 0x85A9FF)
}

extension Color {
    init(hex: UInt32) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255
        )
    }
}

extension View {
    /** Dark graphite backgrounds for lists and forms. */
    func pmBackground() -> some View {
        scrollContentBackground(.hidden).background(Palette.canvas)
    }
}

extension EntryType {
    var symbol: String {
        switch self {
        case .login: return "key.fill"
        case .card: return "creditcard.fill"
        case .identity: return "person.text.rectangle.fill"
        case .note: return "note.text"
        case .document: return "doc.fill"
        }
    }
}

/** A rounded letter tile standing in for a site icon. */
struct Monogram: View {
    let entry: VaultEntry

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 10).fill(Palette.raised)
            RoundedRectangle(cornerRadius: 10).strokeBorder(Palette.lineStrong)
            if entry.isLogin {
                Text(letter).font(.headline).foregroundStyle(Palette.bright)
            } else {
                Image(systemName: entry.entryType.symbol).foregroundStyle(Palette.accent)
            }
        }
        .frame(width: 40, height: 40)
        .accessibilityHidden(true)
    }

    private var letter: String {
        entry.title.first { $0.isLetter || $0.isNumber }.map { String($0).uppercased() } ?? "•"
    }
}

struct EntryRow: View {
    let entry: VaultEntry

    var body: some View {
        HStack(spacing: 12) {
            Monogram(entry: entry)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 4) {
                    Text(entry.title).foregroundStyle(Palette.bright).lineLimit(1)
                    if entry.favorite {
                        Image(systemName: "star.fill").font(.caption2).foregroundStyle(Palette.warn)
                            .accessibilityLabel("Favorite")
                    }
                }
                if !entry.detail.isEmpty {
                    Text(entry.detail).font(.subheadline).foregroundStyle(Palette.muted).lineLimit(1)
                }
            }
        }
        .padding(.vertical, 2)
    }
}
