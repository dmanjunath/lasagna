Pod::Spec.new do |s|
  s.name           = 'WindowCanvas'
  s.version        = '1.0.0'
  s.summary        = 'Paints the app windows in the active design system canvas.'
  s.description    = 'Sets every scene window and its root view to the canvas, light or dark with the system appearance.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = "**/*.{h,m,swift}"
end
