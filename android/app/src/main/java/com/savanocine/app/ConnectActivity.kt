package com.savanocine.app

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.ProgressBar
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

class ConnectActivity : AppCompatActivity() {

    private val executor = Executors.newSingleThreadExecutor()

    private lateinit var serverUrlInput: EditText
    private lateinit var connectButton: Button
    private lateinit var progressBar: ProgressBar
    private lateinit var statusText: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_connect)

        serverUrlInput = findViewById(R.id.serverUrlInput)
        connectButton = findViewById(R.id.connectButton)
        progressBar = findViewById(R.id.connectProgress)
        statusText = findViewById(R.id.statusText)

        val prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
        val savedUrl = prefs.getString(KEY_SERVER_URL, DEFAULT_SERVER_URL) ?: DEFAULT_SERVER_URL
        serverUrlInput.setText(savedUrl)

        val skipAutoConnect = intent.getBooleanExtra(EXTRA_SKIP_AUTO, false)
        if (!skipAutoConnect && prefs.contains(KEY_SERVER_URL)) {
            tryConnect(savedUrl, silentAuto = true)
        }

        connectButton.setOnClickListener {
            tryConnect(serverUrlInput.text.toString(), silentAuto = false)
        }
    }

    private fun normalizeUrl(raw: String): String? {
        var cleaned = raw.trim().trimEnd('/')
        if (cleaned.isEmpty()) return null
        if (!cleaned.startsWith("http://") && !cleaned.startsWith("https://")) {
            cleaned = "http://$cleaned"
        }
        return try {
            val parsed = URL(cleaned)
            if (parsed.protocol != "http" && parsed.protocol != "https") null else cleaned
        } catch (_: Exception) {
            null
        }
    }

    private fun tryConnect(rawUrl: String, silentAuto: Boolean) {
        val url = normalizeUrl(rawUrl)
        if (url == null) {
            showStatus("Informe um endereço válido, ex.: http://192.168.18.136:4174")
            return
        }

        setLoading(true)
        if (!silentAuto) {
            statusText.visibility = View.GONE
        }

        executor.execute {
            val reachable = checkHealth(url)
            runOnUiThread {
                setLoading(false)
                if (reachable) {
                    getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                        .edit()
                        .putString(KEY_SERVER_URL, url)
                        .apply()
                    val intent = Intent(this, MainActivity::class.java)
                    intent.putExtra(MainActivity.EXTRA_SERVER_URL, url)
                    startActivity(intent)
                    finish()
                } else {
                    showStatus("Não foi possível conectar em $url. Verifique se o Savano Cine está aberto no PC e no mesmo Wi-Fi.")
                }
            }
        }
    }

    private fun checkHealth(baseUrl: String): Boolean {
        return try {
            val conn = (URL("$baseUrl/api/health").openConnection() as HttpURLConnection).apply {
                connectTimeout = 3500
                readTimeout = 3500
                requestMethod = "GET"
            }
            val code = conn.responseCode
            conn.disconnect()
            code in 200..299
        } catch (_: Exception) {
            false
        }
    }

    private fun setLoading(loading: Boolean) {
        connectButton.isEnabled = !loading
        progressBar.visibility = if (loading) View.VISIBLE else View.GONE
    }

    private fun showStatus(message: String) {
        statusText.text = message
        statusText.visibility = View.VISIBLE
    }

    companion object {
        const val PREFS_NAME = "savano_cine_prefs"
        const val KEY_SERVER_URL = "server_url"
        const val EXTRA_SKIP_AUTO = "skip_auto"
        const val DEFAULT_SERVER_URL = "http://192.168.18.136:4174"
    }
}
