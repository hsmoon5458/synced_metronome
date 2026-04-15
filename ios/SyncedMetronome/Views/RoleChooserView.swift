import SwiftUI

struct RoleChooserView: View {
    @ObservedObject var viewModel: MetronomeViewModel

    var body: some View {
        VStack(spacing: 12) {
            // Host button
            Button(action: {
                viewModel.setRole(.host)
            }) {
                VStack(spacing: 4) {
                    Text(viewModel.hostAvailable ? "Host" : "Host (Occupied)")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundColor(viewModel.hostAvailable ? .white : Color.white.opacity(0.3))

                    Text(viewModel.hostAvailable ? "Control the session" : "Another user is hosting")
                        .font(.system(size: 12))
                        .foregroundColor(Color.white.opacity(viewModel.hostAvailable ? 0.5 : 0.2))
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 16)
                .background(Color.white.opacity(viewModel.hostAvailable ? 0.06 : 0.03))
                .cornerRadius(12)
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(Color.white.opacity(0.06), lineWidth: 1)
                )
            }
            .disabled(!viewModel.hostAvailable)

            // Follow button
            Button(action: {
                viewModel.setRole(.client)
            }) {
                VStack(spacing: 4) {
                    Text("Follow")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundColor(.white)

                    Text("Join and listen")
                        .font(.system(size: 12))
                        .foregroundColor(Color.white.opacity(0.5))
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 16)
                .background(Color.white.opacity(0.06))
                .cornerRadius(12)
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(Color.white.opacity(0.06), lineWidth: 1)
                )
            }

            if !viewModel.hostAvailable {
                Text("Host role is currently occupied.")
                    .font(.system(size: 13))
                    .foregroundColor(Color(hex: "e57373"))
                    .padding(.top, 4)
            }
        }
        .frame(maxWidth: 280)
    }
}
