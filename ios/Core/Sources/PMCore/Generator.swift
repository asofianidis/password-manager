import Foundation

public struct GeneratorOptions: Codable, Equatable, Sendable {
    public var passphrase = false
    public var length = 20
    public var uppercase = true
    public var lowercase = true
    public var digits = true
    public var symbols = true
    public var excludeAmbiguous = false
    public var words = 5
    public var separator = "-"
    public var capitalize = true
    public var includeNumber = true

    public init() {}
}

/** Password generator, matching src/main/generator.ts on the desktop. */
public enum Generator {
    private static let uppercaseSet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    private static let lowercaseSet = "abcdefghijklmnopqrstuvwxyz"
    private static let digitSet = "0123456789"
    private static let symbolSet = "!@#$%^&*()-_=+[]{};:,.<>?/~"
    private static let ambiguous = Set("Il1O0o|`'\";:,.")

    /** The EFF large diceware list (7,776 words, ~12.9 bits each). */
    static let words: [String] = {
        guard let url = Bundle.module.url(forResource: "eff_large_wordlist", withExtension: "txt"),
              let text = try? String(contentsOf: url, encoding: .utf8)
        else { fatalError("eff_large_wordlist.txt is missing") }
        return text.split(whereSeparator: \.isNewline).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    }()

    public static func generate(_ options: GeneratorOptions) -> String {
        options.passphrase ? passphrase(options) : randomPassword(options)
    }

    private static func randomPassword(_ options: GeneratorOptions) -> String {
        var rng = SystemRandomNumberGenerator()
        var sets = [
            options.uppercase ? uppercaseSet : nil,
            options.lowercase ? lowercaseSet : nil,
            options.digits ? digitSet : nil,
            options.symbols ? symbolSet : nil,
        ].compactMap { $0 }.map { set in Array(options.excludeAmbiguous ? set.filter { !ambiguous.contains($0) } : set) }
        if sets.isEmpty { sets = [Array(lowercaseSet)] }
        let length = max(options.length, sets.count)
        // Guarantee at least one character from each enabled set
        var chars = sets.map { $0.randomElement(using: &rng)! }
        let all = sets.flatMap { $0 }
        while chars.count < length { chars.append(all.randomElement(using: &rng)!) }
        chars.shuffle(using: &rng)
        return String(chars)
    }

    private static func passphrase(_ options: GeneratorOptions) -> String {
        var rng = SystemRandomNumberGenerator()
        var picked = (0..<max(0, options.words)).map { _ -> String in
            let word = words.randomElement(using: &rng)!
            return options.capitalize ? word.prefix(1).uppercased() + word.dropFirst() : word
        }
        if options.includeNumber && !picked.isEmpty {
            let index = Int.random(in: 0..<picked.count, using: &rng)
            picked[index] += String(Int.random(in: 0..<10, using: &rng))
        }
        return picked.joined(separator: options.separator)
    }
}
