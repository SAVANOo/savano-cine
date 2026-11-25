# Savano Cine R8 / ProGuard rules
-keepattributes *Annotation*
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# Keep BuildConfig and app entry points
-keep class com.savanocine.app.BuildConfig { *; }
-keep class com.savanocine.app.ConnectActivity { *; }
-keep class com.savanocine.app.MainActivity { *; }

# Keep WebView JS/WebChrome callbacks if added later
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Keep SwipeRefreshLayout & Material components
-keepclassmembers class androidx.swiperefreshlayout.widget.SwipeRefreshLayout { *; }
-dontwarn org.conscrypt.**
-dontwarn okhttp3.**
