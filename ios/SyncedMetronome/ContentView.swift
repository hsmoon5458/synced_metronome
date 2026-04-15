import SwiftUI

struct ContentView: View {
    @StateObject private var viewModel = MetronomeViewModel()

    var body: some View {
        ZStack {
            // Background
            (viewModel.isRunning ? Color(hex: "120d06") : Color(hex: "0e0e10"))
                .ignoresSafeArea()
                .animation(.easeInOut(duration: 0.6), value: viewModel.isRunning)

            // Aura glow when playing
            if viewModel.isRunning {
                RadialGradient(
                    colors: [Color.orange.opacity(0.1), .clear],
                    center: .center,
                    startRadius: 0,
                    endRadius: 300
                )
                .ignoresSafeArea()
            }

            // Flash overlay
            FlashOverlay(trigger: viewModel.flashTrigger, isAccent: viewModel.isAccentBeat)

            ScrollView {
                VStack(spacing: 0) {
                    // Header
                    Text("Synced Metronome")
                        .font(.system(size: 26, weight: .bold))
                        .foregroundColor(.white)

                    Text("v1.0.0")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(Color.white.opacity(0.25))
                        .textCase(.uppercase)
                        .padding(.top, 2)

                    Text("Developer: Hye Sung Moon")
                        .font(.system(size: 11))
                        .foregroundColor(Color.white.opacity(0.25))
                        .padding(.top, 1)

                    // Connection status
                    ConnectionStatusView(isConnected: viewModel.isConnected)
                        .padding(.top, 8)

                    // Server status text (waking up, connecting, etc.)
                    if !viewModel.statusText.isEmpty {
                        Text(viewModel.statusText)
                            .font(.system(size: 13, weight: .medium))
                            .foregroundColor(Color.orange.opacity(0.7))
                            .padding(.top, 6)
                    }

                    // Beat dots
                    BeatDotsView(
                        numerator: viewModel.timeSignature.numerator,
                        activeBeatIndex: viewModel.activeBeatIndex
                    )
                    .padding(.vertical, 16)

                    // Card
                    VStack(spacing: 16) {
                        if viewModel.role == nil {
                            RoleChooserView(viewModel: viewModel)
                        } else if viewModel.role == .host {
                            hostView
                        } else {
                            clientView
                        }
                    }
                    .padding(20)
                    .background(
                        RoundedRectangle(cornerRadius: 20)
                            .fill(viewModel.isRunning
                                  ? Color.orange.opacity(0.03)
                                  : Color.white.opacity(0.04))
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 20)
                            .stroke(viewModel.isRunning
                                    ? Color.orange.opacity(0.12)
                                    : Color.white.opacity(0.08), lineWidth: 1)
                    )
                    .shadow(color: viewModel.isRunning ? Color.orange.opacity(0.05) : .clear, radius: 40)
                }
                .padding(.horizontal)
                .padding(.top, 16)
            }
        }
        .onDisappear {
            viewModel.disconnect()
        }
    }

    // MARK: - Host view

    private var hostView: some View {
        VStack(spacing: 12) {
            Text("\(viewModel.clientCount) client\(viewModel.clientCount == 1 ? "" : "s") connected")
                .font(.system(size: 13, weight: .medium))
                .foregroundColor(Color.orange.opacity(0.6))

            HostControlsView(viewModel: viewModel)
        }
    }

    // MARK: - Client view

    private var clientView: some View {
        VStack(spacing: 8) {
            // BPM display
            Text("\(viewModel.bpm)")
                .font(.system(size: 72, weight: .heavy))
                .foregroundColor(.white)
                .shadow(color: viewModel.isRunning ? Color.orange.opacity(0.25) : .clear, radius: 30)

            // Time signature + subdivision visuals
            HStack(spacing: 32) {
                TimeSignatureVisual(timeSignature: viewModel.timeSignature)
                SubdivisionVisual(subdivision: viewModel.subdivision)
            }
            .padding(.vertical, 8)

            // Status info
            VStack(spacing: 4) {
                let otherCount = max(0, viewModel.clientCount - 1)
                Text(otherCount == 1
                     ? "1 other device connected"
                     : "\(otherCount) other devices connected")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(Color.orange.opacity(0.6))

                Text(viewModel.latencyText)
                    .font(.system(size: 13))
                    .foregroundColor(Color.orange.opacity(0.5))
            }
            .padding(.top, 8)
        }
    }
}

// MARK: - Flash Overlay

struct FlashOverlay: View {
    let trigger: Bool
    let isAccent: Bool
    @State private var isFlashing = false

    var body: some View {
        (isAccent ? Color(hex: "2a1a00") : Color(hex: "1a1a1a"))
            .ignoresSafeArea()
            .opacity(isFlashing ? 1 : 0)
            .animation(.easeOut(duration: 0.05), value: isFlashing)
            .onChange(of: trigger) { _ in
                isFlashing = true
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
                    isFlashing = false
                }
            }
            .allowsHitTesting(false)
    }
}

// MARK: - Color extension

extension Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let a, r, g, b: UInt64
        switch hex.count {
        case 6:
            (a, r, g, b) = (255, int >> 16, int >> 8 & 0xFF, int & 0xFF)
        case 8:
            (a, r, g, b) = (int >> 24, int >> 16 & 0xFF, int >> 8 & 0xFF, int & 0xFF)
        default:
            (a, r, g, b) = (255, 0, 0, 0)
        }
        self.init(
            .sRGB,
            red: Double(r) / 255,
            green: Double(g) / 255,
            blue: Double(b) / 255,
            opacity: Double(a) / 255
        )
    }
}
