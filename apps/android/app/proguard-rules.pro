# No reflective protocol mapping: all gateway JSON is explicitly decoded.
-keepattributes Signature,InnerClasses,EnclosingMethod

-keepclassmembers class * { @android.webkit.JavascriptInterface <methods>; }
