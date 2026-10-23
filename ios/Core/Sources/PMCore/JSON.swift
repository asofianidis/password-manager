import Foundation

/**
 * JSON written with a fixed key order and JavaScript's string escaping, so that what this app
 * writes is exactly what the desktop's `JSON.stringify` would. Reading uses Codable; writing
 * goes through this because JSONEncoder doesn't promise any key order, and the merge tie-break
 * compares serialized entries (see [canonicalJson]).
 */
public indirect enum JSON: Equatable {
    case string(String)
    case int(Int64)
    case bool(Bool)
    case null
    case array([JSON])
    case object([(String, JSON)])

    public static func == (a: JSON, b: JSON) -> Bool { a.text == b.text }

    public var text: String {
        var out = ""
        write(into: &out)
        return out
    }

    func write(into out: inout String) {
        switch self {
        case .string(let value): writeJsString(value, into: &out)
        case .int(let value): out += String(value)
        case .bool(let value): out += value ? "true" : "false"
        case .null: out += "null"
        case .array(let items):
            out += "["
            for (index, item) in items.enumerated() {
                if index > 0 { out += "," }
                item.write(into: &out)
            }
            out += "]"
        case .object(let fields):
            out += "{"
            for (index, (key, value)) in fields.enumerated() {
                if index > 0 { out += "," }
                writeJsString(key, into: &out)
                out += ":"
                value.write(into: &out)
            }
            out += "}"
        }
    }
}

/// Swift strings can't hold lone surrogates, the one case where JSON.stringify escapes beyond this.
private func writeJsString(_ value: String, into out: inout String) {
    out += "\""
    for scalar in value.unicodeScalars {
        switch scalar {
        case "\"": out += "\\\""
        case "\\": out += "\\\\"
        case "\u{08}": out += "\\b"
        case "\u{0C}": out += "\\f"
        case "\n": out += "\\n"
        case "\r": out += "\\r"
        case "\t": out += "\\t"
        default:
            if scalar.value < 0x20 {
                let hex = String(scalar.value, radix: 16)
                out += "\\u" + String(repeating: "0", count: 4 - hex.count) + hex
            } else {
                out.unicodeScalars.append(scalar)
            }
        }
    }
    out += "\""
}

protocol JSONWritable {
    var json: JSON { get }
}

extension Array where Element: JSONWritable {
    var json: JSON { .array(map(\.json)) }
}

extension Optional where Wrapped == String {
    var json: JSON { map { .string($0) } ?? .null }
}

/** Builds an object, leaving out fields whose value is nil (as `explicitNulls = false` does on Android). */
func object(_ fields: [(String, JSON?)]) -> JSON {
    .object(fields.compactMap { key, value in value.map { (key, $0) } })
}

let jsonDecoder = JSONDecoder()

func decode<T: Decodable>(_ type: T.Type, _ text: String) throws -> T {
    try jsonDecoder.decode(type, from: Data(text.utf8))
}
