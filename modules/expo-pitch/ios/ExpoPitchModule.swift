import ExpoModulesCore

public class ExpoPitchModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ExpoPitch")

    Function("echoDouble") { (x: Double) -> Double in
      return x * 2
    }

    Function("sumArray") { (values: [Double]) -> Double in
      var total = 0.0
      for v in values {
        total += v
      }
      return total
    }

AsyncFunction("detectPitch") { (samples: [Double], sampleRate: Double) -> [[String: Double]] in
  let W = 512
  let hop = 200
  let minF0 = 75.0
  let maxF0 = 400.0
  let threshold = 0.15   // YIN CMND threshold (de Cheveigné & Kawahara 2002)

  let minTau = max(2, Int(sampleRate / maxF0))
  let maxTau = min(Int(sampleRate / minF0), W / 2)

  var frames: [[String: Double]] = []
  let lastStart = samples.count - W
  guard lastStart >= 0 && maxTau > minTau else { return frames }

  for start in stride(from: 0, through: lastStart, by: hop) {
    // Gate on loudness — skip silence before doing the work.
    var energy = 0.0
    for i in 0..<W { energy += samples[start + i] * samples[start + i] }
    if (energy / Double(W)).squareRoot() < 0.01 { continue }

    // Step 1: difference function d(tau)
    var d = [Double](repeating: 0.0, count: maxTau + 1)
    for tau in 1...maxTau {
      var sum = 0.0
      for i in 0..<(W - tau) {
        let delta = samples[start + i] - samples[start + i + tau]
        sum += delta * delta
      }
      d[tau] = sum
    }

    // Step 2: cumulative mean normalized difference d'(tau)
    var dPrime = [Double](repeating: 0.0, count: maxTau + 1)
    dPrime[0] = 1.0
    var runningSum = 0.0
    for tau in 1...maxTau {
      runningSum += d[tau]
      dPrime[tau] = runningSum > 0 ? d[tau] * Double(tau) / runningSum : 1.0
    }

    // Step 3: absolute threshold — first dip below threshold, descend to its bottom
    var tauEstimate = -1
    var tau = minTau
    while tau <= maxTau {
      if dPrime[tau] < threshold {
        while tau + 1 <= maxTau && dPrime[tau + 1] < dPrime[tau] { tau += 1 }
        tauEstimate = tau
        break
      }
      tau += 1
    }
    if tauEstimate == -1 { continue } // no periodic dip -> unvoiced

    // Step 4: parabolic interpolation for sub-sample precision
    var betterTau = Double(tauEstimate)
    if tauEstimate > 1 && tauEstimate + 1 <= maxTau {
      let s0 = dPrime[tauEstimate - 1]
      let s1 = dPrime[tauEstimate]
      let s2 = dPrime[tauEstimate + 1]
      let denom = 2.0 * (2.0 * s1 - s2 - s0)
      if denom != 0 { betterTau = Double(tauEstimate) + (s2 - s0) / denom }
    }

    frames.append([
      "t": Double(start) / sampleRate,
      "f0Hz": sampleRate / betterTau
    ])
  }

  return frames
}
  }
}