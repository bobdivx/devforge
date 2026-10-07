package app.jeser.devforge

object Fixtures {
    fun read(name: String): String =
        requireNotNull(javaClass.classLoader!!.getResource("fixtures/$name")) { "fixture $name" }.readText()
}
