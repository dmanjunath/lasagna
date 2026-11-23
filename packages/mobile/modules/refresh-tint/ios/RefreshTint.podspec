Pod::Spec.new do |s|
  s.name           = 'RefreshTint'
  s.version        = '1.0.0'
  s.summary        = 'Tints the system pull to refresh with the active design system.'
  s.description    = 'Sets the UIRefreshControl appearance tint (a web screen\'s pull to refresh) at runtime.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = "**/*.{h,m,swift}"
end
