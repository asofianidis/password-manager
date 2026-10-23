import PMCore
import SwiftUI
import UIKit.UIGestureRecognizerSubclass

@main
struct PasswordManagerApp: App {
    @State private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .preferredColorScheme(.dark)
                .tint(Palette.accent)
        }
    }
}

struct RootView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        ZStack {
            Palette.canvas.ignoresSafeArea()
            if let error = model.loadError {
                ContentUnavailableView("Vault unavailable", systemImage: "exclamationmark.triangle", description: Text(error))
            } else {
                switch model.status.state {
                case .noVault: SetupView()
                case .locked: LockedView()
                case .unlocked: HomeView()
                }
            }
            // Keeps the vault out of the app switcher's snapshot
            if scenePhase != .active && model.settings.hideInSwitcher {
                Palette.canvas.ignoresSafeArea().overlay(Logo(size: 96))
            }
        }
        .background(ActivityTracker { model.touch() })
        .overlay(alignment: .bottom) { Toast() }
        .onChange(of: scenePhase) { model.scenePhaseChanged(scenePhase) }
    }
}

/** A short message at the bottom of the screen that goes away by itself. */
private struct Toast: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        if let text = model.toast {
            Text(text)
                .font(.subheadline)
                .foregroundStyle(Palette.bright)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(Palette.raised, in: Capsule())
                .overlay(Capsule().strokeBorder(Palette.lineStrong))
                .padding(.bottom, 64)
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .task(id: text) {
                    try? await Task.sleep(for: .seconds(text.contains("\n") ? 5 : 2.5))
                    withAnimation { model.toast = nil }
                }
        }
    }
}

/**
 * Reports every touch in the window without interfering with it, so any use of the app pushes
 * the auto-lock deadline back.
 */
private struct ActivityTracker: UIViewRepresentable {
    let onActivity: () -> Void

    func makeUIView(context: Context) -> TrackerView {
        TrackerView(onActivity: onActivity)
    }

    func updateUIView(_ view: TrackerView, context: Context) {
        view.recognizer.onActivity = onActivity
    }

    final class TrackerView: UIView {
        let recognizer: TouchRecognizer

        init(onActivity: @escaping () -> Void) {
            recognizer = TouchRecognizer(onActivity: onActivity)
            super.init(frame: .zero)
            isUserInteractionEnabled = false
        }

        required init?(coder: NSCoder) { fatalError() }

        override func didMoveToWindow() {
            super.didMoveToWindow()
            recognizer.view?.removeGestureRecognizer(recognizer)
            window?.addGestureRecognizer(recognizer)
        }
    }

    final class TouchRecognizer: UIGestureRecognizer, UIGestureRecognizerDelegate {
        var onActivity: () -> Void

        init(onActivity: @escaping () -> Void) {
            self.onActivity = onActivity
            super.init(target: nil, action: nil)
            cancelsTouchesInView = false
            delaysTouchesBegan = false
            delaysTouchesEnded = false
            delegate = self
        }

        override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
            onActivity()
            state = .failed
        }

        func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
            true
        }
    }
}
