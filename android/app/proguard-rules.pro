# kotlinx.serialization, OkHttp, and AndroidX ship their own rules.

# Only BouncyCastle's Argon2 generator is used, and R8 keeps what it references. The rest of the
# library refers to optional classes that aren't on Android.
-dontwarn org.bouncycastle.**
