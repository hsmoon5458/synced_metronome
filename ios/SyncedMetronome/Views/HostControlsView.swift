import SwiftUI

struct HostControlsView: View {
    @ObservedObject var viewModel: MetronomeViewModel

    var body: some View {
        VStack(spacing: 16) {
            // BPM Controls
            bpmControls

            // Start / Stop buttons
            HStack(spacing: 12) {
                Button(action: { viewModel.startMetronome() }) {
                    Text("Start")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundColor(viewModel.isRunning ? Color.white.opacity(0.3) : Color(hex: "111111"))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .background(viewModel.isRunning ? Color.white.opacity(0.03) : Color.orange)
                        .cornerRadius(12)
                }
                .disabled(viewModel.isRunning)

                Button(action: { viewModel.stopMetronome() }) {
                    Text("Stop")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundColor(!viewModel.isRunning ? Color.white.opacity(0.3) : Color(hex: "111111"))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .background(!viewModel.isRunning ? Color.white.opacity(0.03) : Color.orange)
                        .cornerRadius(12)
                }
                .disabled(!viewModel.isRunning)
            }

            // Time Signature
            VStack(alignment: .leading, spacing: 6) {
                Text("Time Signature:")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(Color.white.opacity(0.7))

                Picker("Time Signature", selection: Binding(
                    get: { viewModel.timeSignature },
                    set: { viewModel.setTimeSignature($0) }
                )) {
                    ForEach(TimeSignature.allCases, id: \.self) { ts in
                        Text(ts.rawValue).tag(ts)
                    }
                }
                .pickerStyle(.segmented)
            }

            // Subdivision
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text("Subdivision:")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(Color.white.opacity(0.7))

                    Spacer()

                    SubdivisionVisual(subdivision: viewModel.subdivision)
                }

                Picker("Subdivision", selection: Binding(
                    get: { viewModel.subdivision },
                    set: { viewModel.setSubdivision($0) }
                )) {
                    ForEach(Subdivision.allCases, id: \.self) { sub in
                        Text(sub.displayName).tag(sub)
                    }
                }
                .pickerStyle(.menu)
                .padding(8)
                .background(Color.black.opacity(0.35))
                .cornerRadius(8)
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(Color.white.opacity(0.1), lineWidth: 1)
                )
            }

            // Preset Bank
            PresetBankView(viewModel: viewModel)
        }
    }

    // MARK: - BPM Controls

    private var bpmControls: some View {
        VStack(spacing: 12) {
            HStack(spacing: 12) {
                // Minus button
                Button(action: { viewModel.changeBpm(-1) }) {
                    Text("-")
                        .font(.system(size: 22, weight: .semibold))
                        .foregroundColor(.orange)
                        .frame(width: 44, height: 44)
                        .background(Color.white.opacity(0.06))
                        .clipShape(Circle())
                        .overlay(Circle().stroke(Color.white.opacity(0.08), lineWidth: 1))
                }

                // BPM value
                TextField("BPM", value: Binding(
                    get: { viewModel.bpm },
                    set: { viewModel.setBpm($0) }
                ), format: .number)
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundColor(.white)
                    .multilineTextAlignment(.center)
                    .frame(width: 72)
                    .padding(8)
                    .background(Color.black.opacity(0.35))
                    .cornerRadius(10)
                    .overlay(
                        RoundedRectangle(cornerRadius: 10)
                            .stroke(Color.white.opacity(0.1), lineWidth: 1)
                    )
                    .keyboardType(.numberPad)

                // Plus button
                Button(action: { viewModel.changeBpm(1) }) {
                    Text("+")
                        .font(.system(size: 22, weight: .semibold))
                        .foregroundColor(.orange)
                        .frame(width: 44, height: 44)
                        .background(Color.white.opacity(0.06))
                        .clipShape(Circle())
                        .overlay(Circle().stroke(Color.white.opacity(0.08), lineWidth: 1))
                }
            }

            // BPM Slider
            Slider(
                value: Binding(
                    get: { Double(viewModel.bpm) },
                    set: { newVal in
                        viewModel.bpm = Int(newVal)
                        viewModel.debouncedBpmUpdate()
                    }
                ),
                in: 30...300,
                step: 1
            )
            .accentColor(.orange)
        }
    }
}
