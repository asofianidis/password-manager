import PMCore
import SwiftUI

struct GeneratorView: View {
    @Environment(AppModel.self) private var model
    @State private var password = ""

    var body: some View {
        @Bindable var settings = model.settings
        Form {
            Section {
                Text(password)
                    .font(.title3.monospaced())
                    .foregroundStyle(Palette.bright)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, minHeight: 60, alignment: .leading)
                HStack {
                    Button { regenerate() } label: { Label("Regenerate", systemImage: "arrow.clockwise").frame(maxWidth: .infinity) }
                        .buttonStyle(.bordered)
                    Button { model.copy("Password", password) } label: { Label("Copy", systemImage: "doc.on.doc").frame(maxWidth: .infinity) }
                        .buttonStyle(.borderedProminent)
                }
            }
            Section {
                Picker("Kind", selection: $settings.generator.passphrase) {
                    Text("Random").tag(false)
                    Text("Passphrase").tag(true)
                }
                .pickerStyle(.segmented)
                if settings.generator.passphrase {
                    Stepper("Words: \(settings.generator.words)", value: $settings.generator.words, in: 3...10)
                    Picker("Separator", selection: $settings.generator.separator) {
                        Text("Hyphen").tag("-")
                        Text("Space").tag(" ")
                        Text("Period").tag(".")
                        Text("Underscore").tag("_")
                    }
                    Toggle("Capitalize", isOn: $settings.generator.capitalize)
                    Toggle("Include a number", isOn: $settings.generator.includeNumber)
                } else {
                    VStack(alignment: .leading) {
                        Text("Length: \(settings.generator.length)")
                        Slider(
                            value: Binding(get: { Double(settings.generator.length) }, set: { settings.generator.length = Int($0) }),
                            in: 8...64,
                            step: 1
                        )
                    }
                    Toggle("Uppercase (A-Z)", isOn: $settings.generator.uppercase)
                    Toggle("Lowercase (a-z)", isOn: $settings.generator.lowercase)
                    Toggle("Digits (0-9)", isOn: $settings.generator.digits)
                    Toggle("Symbols (!@#…)", isOn: $settings.generator.symbols)
                    Toggle("Avoid look-alikes (l, 1, O, 0)", isOn: $settings.generator.excludeAmbiguous)
                }
            }
        }
        .pmBackground()
        .navigationTitle("Generator")
        .onAppear { if password.isEmpty { regenerate() } }
        .onChange(of: model.settings.generator) { regenerate() }
    }

    private func regenerate() {
        password = Generator.generate(model.settings.generator)
    }
}
