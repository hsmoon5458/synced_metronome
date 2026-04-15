import SwiftUI

struct TimeSignatureVisual: View {
    let timeSignature: TimeSignature

    var body: some View {
        VStack(spacing: 0) {
            Text("\(timeSignature.numerator)")
                .font(.system(size: 18, weight: .bold))
                .foregroundColor(.white)

            Rectangle()
                .fill(Color.orange)
                .frame(width: 22, height: 1.5)
                .cornerRadius(1)

            Text("\(timeSignature.denominator)")
                .font(.system(size: 18, weight: .bold))
                .foregroundColor(.white)
        }
        .frame(width: 32, height: 44)
        .background(Color.white.opacity(0.04))
        .cornerRadius(6)
        .overlay(
            RoundedRectangle(cornerRadius: 6)
                .stroke(Color.white.opacity(0.06), lineWidth: 1)
        )
    }
}

struct SubdivisionVisual: View {
    let subdivision: Subdivision

    var body: some View {
        Text(subdivisionSymbol)
            .font(.system(size: 24))
            .foregroundColor(Color.orange.opacity(0.9))
            .frame(height: 44)
    }

    private var subdivisionSymbol: String {
        switch subdivision {
        case .quarter: return "\u{2669}"   // quarter note
        case .eighth: return "\u{266B}"    // beamed eighth notes
        case .triplet: return "\u{266B}3"  // triplet indicator
        case .sixteenth: return "\u{266C}" // beamed sixteenth notes
        }
    }
}
