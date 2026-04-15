import Foundation

enum UserRole: String {
    case host
    case client
}

enum TimeSignature: String, CaseIterable {
    case fourFour = "4/4"
    case threeFour = "3/4"
    case sixEight = "6/8"

    var numerator: Int {
        switch self {
        case .fourFour: return 4
        case .threeFour: return 3
        case .sixEight: return 6
        }
    }

    var denominator: Int {
        switch self {
        case .fourFour: return 4
        case .threeFour: return 4
        case .sixEight: return 8
        }
    }
}

enum Subdivision: Int, CaseIterable {
    case quarter = 1
    case eighth = 2
    case triplet = 3
    case sixteenth = 4

    var displayName: String {
        switch self {
        case .quarter: return "Quarter Note (1/4)"
        case .eighth: return "Eighth Note (1/8)"
        case .triplet: return "Eighth Note Triplets"
        case .sixteenth: return "Sixteenth Note (1/16)"
        }
    }

    var shortName: String {
        switch self {
        case .quarter: return "quarter"
        case .eighth: return "eighth"
        case .triplet: return "triplet"
        case .sixteenth: return "sixteenth"
        }
    }
}

struct Preset: Codable, Identifiable {
    let id: UUID
    let name: String
    let bpm: Int
    let timeSignature: String
    let subdivision: Int

    init(bpm: Int, timeSignature: String, subdivision: Int) {
        self.id = UUID()
        self.name = "\(bpm) BPM, \(timeSignature), Sub: \(subdivision)"
        self.bpm = bpm
        self.timeSignature = timeSignature
        self.subdivision = subdivision
    }
}

struct SyncData {
    var bpm: Int
    var startTime: Double?
    var isRunning: Bool
    var timeSignature: String
    var subdivision: Int
}
