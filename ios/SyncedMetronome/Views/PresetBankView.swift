import SwiftUI

struct PresetBankView: View {
    @ObservedObject var viewModel: MetronomeViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Divider()
                .background(Color.white.opacity(0.06))

            Text("Preset Bank")
                .font(.system(size: 14, weight: .semibold))
                .foregroundColor(Color.white.opacity(0.7))

            Button(action: { viewModel.savePreset() }) {
                Text("Save Current Preset")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .background(Color.white.opacity(0.06))
                    .cornerRadius(8)
                    .overlay(
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(Color.white.opacity(0.06), lineWidth: 1)
                    )
            }

            ForEach(viewModel.presets) { preset in
                HStack {
                    Text("\(preset.bpm) BPM \(preset.timeSignature), \(Subdivision(rawValue: preset.subdivision)?.shortName ?? "custom")")
                        .font(.system(size: 14))
                        .foregroundColor(.white)
                        .lineLimit(1)

                    Spacer()

                    Button("load") {
                        viewModel.loadPreset(preset)
                    }
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(.orange)
                    .opacity(0.7)

                    Button("delete") {
                        viewModel.deletePreset(preset)
                    }
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(.orange)
                    .opacity(0.7)
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
                .background(Color.white.opacity(0.03))
                .cornerRadius(8)
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(Color.white.opacity(0.05), lineWidth: 1)
                )
            }
        }
    }
}
