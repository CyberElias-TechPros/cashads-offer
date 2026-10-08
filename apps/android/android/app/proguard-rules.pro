# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# ── Partner rewarded-video SDKs ─────────────────────────────────────────────
# Their listeners/callbacks are invoked reflectively; keep them whole.
-keep class com.applovin.** { *; }
-keep class com.bytedance.sdk.openadsdk.** { *; }
-keep class com.yango.mobile.ads.** { *; }
-dontwarn com.applovin.**
-dontwarn com.bytedance.sdk.openadsdk.**
-dontwarn com.yango.mobile.ads.**

# Capacitor bridge (only matters once minifyEnabled is on for release builds).
-keep class app.lucrum.mobile.** { *; }
-keep class com.getcapacitor.** { *; }
