; Browsers start the native messaging host by running password-manager.exe from the install
; folder (see src/main/browser/install.ts), and the extension relaunches it on every request. A
; running host locks the old files, so updating fails with "Failed to uninstall old application
; files". Unregistering the host first stops browsers relaunching it once the installer kills it.
; The app registers it again each time it starts.
!macro unregisterNativeHost
  DeleteRegKey HKCU "Software\Google\Chrome\NativeMessagingHosts\com.password_manager.host"
  DeleteRegKey HKCU "Software\Chromium\NativeMessagingHosts\com.password_manager.host"
  DeleteRegKey HKCU "Software\Microsoft\Edge\NativeMessagingHosts\com.password_manager.host"
  DeleteRegKey HKCU "Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.password_manager.host"
  DeleteRegKey HKCU "Software\Mozilla\NativeMessagingHosts\com.password_manager.host"
!macroend

; Runs before the installer closes the running app and removes the old version
!macro customInit
  !insertmacro unregisterNativeHost
!macroend

; Uninstalling also leaves nothing for browsers to launch
!macro customUnInit
  !insertmacro unregisterNativeHost
!macroend
