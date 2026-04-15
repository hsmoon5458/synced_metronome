import SwiftUI

struct ConnectionStatusView: View {
    let isConnected: Bool

    var body: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(isConnected ? Color.green : Color.red)
                .frame(width: 6, height: 6)
                .shadow(color: isConnected ? Color.green.opacity(0.5) : Color.red.opacity(0.5), radius: 3)

            Text(isConnected ? "Connected" : "Reconnecting...")
                .font(.system(size: 12))
                .foregroundColor(Color.white.opacity(0.4))
        }
    }
}
