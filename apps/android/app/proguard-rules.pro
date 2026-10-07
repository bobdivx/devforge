# kotlinx.serialization : les règles consommateur de la lib couvrent @Serializable.
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keep,includedescriptorclasses class app.jeser.devforge.data.**$$serializer { *; }
-keepclassmembers class app.jeser.devforge.data.** {
    *** Companion;
}
-keepclasseswithmembers class app.jeser.devforge.data.** {
    kotlinx.serialization.KSerializer serializer(...);
}
# Tink (security-crypto) référence des annotations absentes à l'exécution.
-dontwarn com.google.errorprone.annotations.**
-dontwarn javax.annotation.**
