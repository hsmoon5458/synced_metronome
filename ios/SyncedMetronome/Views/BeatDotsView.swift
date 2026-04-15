import SwiftUI

struct BeatDotsView: View {
    let numerator: Int
    let activeBeatIndex: Int

    var body: some View {
        HStack(spacing: numerator > 4 ? 8 : 16) {
            ForEach(0..<numerator, id: \.self) { index in
                BeatDot(
                    isActive: index == activeBeatIndex,
                    isAccent: index == 0
                )
            }
        }
    }
}

struct BeatDot: View {
    let isActive: Bool
    let isAccent: Bool

    var body: some View {
        Circle()
            .fill(dotFill)
            .frame(width: 44, height: 44)
            .overlay(
                Circle()
                    .stroke(dotStroke, lineWidth: 2)
            )
            .scaleEffect(isActive ? 1.15 : 1.0)
            .shadow(color: dotShadow, radius: isActive ? 20 : 0)
            .animation(.easeOut(duration: 0.12), value: isActive)
    }

    private var dotFill: some ShapeStyle {
        if isActive {
            if isAccent {
                return AnyShapeStyle(
                    RadialGradient(
                        colors: [Color(hex: "ffe0b2"), Color(hex: "ffb74d")],
                        center: UnitPoint(x: 0.4, y: 0.35),
                        startRadius: 0,
                        endRadius: 22
                    )
                )
            } else {
                return AnyShapeStyle(
                    RadialGradient(
                        colors: [Color(hex: "ffb74d"), Color.orange],
                        center: UnitPoint(x: 0.4, y: 0.35),
                        startRadius: 0,
                        endRadius: 22
                    )
                )
            }
        } else {
            return AnyShapeStyle(Color.white.opacity(0.04))
        }
    }

    private var dotStroke: Color {
        if isActive {
            return isAccent ? .white : .orange
        }
        return isAccent ? Color.orange.opacity(0.3) : Color.white.opacity(0.06)
    }

    private var dotShadow: Color {
        if isActive {
            return isAccent ? Color(hex: "ffd180").opacity(0.5) : Color.orange.opacity(0.4)
        }
        return .clear
    }
}
