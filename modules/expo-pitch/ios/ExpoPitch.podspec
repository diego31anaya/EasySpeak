Pod::Spec.new do |s|
  s.name           = 'ExpoPitch'
  s.version        = '1.0.0'
  s.summary        = 'Native pitch detection for EasySpeak'
  s.description    = 'Computes fundamental frequency from PCM samples.'
  s.author         = ''
  s.homepage       = 'https://example.com'
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
