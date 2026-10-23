// swift-tools-version:5.9
import PackageDescription

// The vault, crypto, sync, and URL matching shared by the iOS app and its AutoFill extension.
// It has no UIKit dependency, so `swift test` runs it on macOS or Linux. Apple platforms use
// CryptoKit; elsewhere swift-crypto provides the same API.
#if os(Linux)
let cryptoPackages: [Package.Dependency] = [.package(url: "https://github.com/apple/swift-crypto.git", "3.0.0"..<"5.0.0")]
let cryptoProducts: [Target.Dependency] = [.product(name: "Crypto", package: "swift-crypto")]
#else
let cryptoPackages: [Package.Dependency] = []
let cryptoProducts: [Target.Dependency] = []
#endif

let package = Package(
    name: "PMCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "PMCore", targets: ["PMCore"])],
    dependencies: cryptoPackages,
    targets: [
        // The Argon2 reference implementation (phc-winner-argon2 20190702), unmodified
        .target(
            name: "CArgon2",
            exclude: ["LICENSE"],
            cSettings: [
                .define("ARGON2_NO_THREADS"),
                // Unoptimized Argon2 takes seconds; keep debug builds usable
                .unsafeFlags(["-O3"]),
            ]
        ),
        .target(
            name: "PMCore",
            dependencies: ["CArgon2"] + cryptoProducts,
            resources: [.copy("Resources/public_suffix_list.dat"), .copy("Resources/eff_large_wordlist.txt")]
        ),
        .testTarget(name: "PMCoreTests", dependencies: ["PMCore"]),
    ]
)
