package app.lucrum.mobile

import android.os.Bundle
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        // Register the native bridge before the bridge starts loading the web app.
        registerPlugin(LucrumBridgePlugin::class.java)
        super.onCreate(savedInstanceState)
    }
}
