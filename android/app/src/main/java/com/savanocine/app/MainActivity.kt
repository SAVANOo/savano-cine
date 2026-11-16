package com.savanocine.app

import android.annotation.SuppressLint
import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.content.pm.ActivityInfo
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.view.View
import android.webkit.CookieManager
import android.webkit.URLUtil
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

class MainActivity : AppCompatActivity() {

    private val executor = Executors.newSingleThreadExecutor()
    private var lastBackPressedAt = 0L

    private lateinit var webView: WebView
    private lateinit var swipeRefresh: SwipeRefreshLayout
    private lateinit var fullscreenContainer: FrameLayout
    private lateinit var offlineOverlay: LinearLayout
    private lateinit var offlineDetail: TextView
    private lateinit var retryButton: Button
    private lateinit var changeServerButton: Button

    private var customView: View? = null
    private var customViewCallback: WebChromeClient.CustomViewCallback? = null
    private var serverUrl: String = ConnectActivity.DEFAULT_SERVER_URL

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        serverUrl = intent.getStringExtra(EXTRA_SERVER_URL)
            ?: getSharedPreferences(ConnectActivity.PREFS_NAME, MODE_PRIVATE)
                .getString(ConnectActivity.KEY_SERVER_URL, ConnectActivity.DEFAULT_SERVER_URL)
            ?: ConnectActivity.DEFAULT_SERVER_URL

        webView = findViewById(R.id.webView)
        swipeRefresh = findViewById(R.id.swipeRefresh)
        fullscreenContainer = findViewById(R.id.fullscreenContainer)
        offlineOverlay = findViewById(R.id.offlineOverlay)
        offlineDetail = findViewById(R.id.offlineDetail)
        retryButton = findViewById(R.id.retryButton)
        changeServerButton = findViewById(R.id.changeServerButton)

        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = true
            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            useWideViewPort = true
            loadWithOverviewMode = true
        }

        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                swipeRefresh.isRefreshing = false
                offlineOverlay.visibility = View.GONE
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?
            ) {
                if (request?.isForMainFrame == true) {
                    swipeRefresh.isRefreshing = false
                    offlineDetail.text = "Não foi possível alcançar $serverUrl.\nAbra o Savano Cine no PC e tente novamente."
                    offlineOverlay.visibility = View.VISIBLE
                }
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowCustomView(view: View?, callback: CustomViewCallback?) {
                if (view == null) return
                if (customView != null) {
                    callback?.onCustomViewHidden()
                    return
                }
                customView = view
                customViewCallback = callback
                fullscreenContainer.addView(view)
                fullscreenContainer.visibility = View.VISIBLE
                requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                toggleSystemBars(false)
            }

            override fun onHideCustomView() {
                val view = customView ?: return
                fullscreenContainer.removeView(view)
                fullscreenContainer.visibility = View.GONE
                customView = null
                customViewCallback?.onCustomViewHidden()
                customViewCallback = null
                requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
                toggleSystemBars(true)
            }
        }

        webView.setDownloadListener { url, userAgent, contentDisposition, mimetype, _ ->
            try {
                val request = DownloadManager.Request(Uri.parse(url)).apply {
                    setMimeType(mimetype)
                    addRequestHeader("User-Agent", userAgent)
                    val filename = URLUtil.guessFileName(url, contentDisposition, mimetype)
                    setTitle(filename)
                    setDescription("Baixando legenda / arquivo do Savano Cine")
                    setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, filename)
                }
                val dm = getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
                dm.enqueue(request)
                Toast.makeText(this, "Download iniciado na pasta Downloads", Toast.LENGTH_SHORT).show()
            } catch (_: Exception) {
                Toast.makeText(this, "Não foi possível baixar o arquivo", Toast.LENGTH_SHORT).show()
            }
        }

        swipeRefresh.setOnRefreshListener {
            webView.reload()
        }

        retryButton.setOnClickListener {
            offlineOverlay.visibility = View.GONE
            webView.loadUrl(serverUrl)
        }

        changeServerButton.setOnClickListener {
            val intent = Intent(this, ConnectActivity::class.java)
            intent.putExtra(ConnectActivity.EXTRA_SKIP_AUTO, true)
            startActivity(intent)
            finish()
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (customView != null) {
                    webView.webChromeClient?.onHideCustomView()
                    return
                }
                if (webView.canGoBack()) {
                    webView.goBack()
                    return
                }
                val now = System.currentTimeMillis()
                if (now - lastBackPressedAt < 2000L) {
                    finish()
                } else {
                    lastBackPressedAt = now
                    Toast.makeText(
                        this@MainActivity,
                        "Deslize ou pressione voltar novamente para sair",
                        Toast.LENGTH_SHORT
                    ).show()
                }
            }
        })

        webView.loadUrl(serverUrl)
        checkAppUpdate()
    }

    private fun checkAppUpdate() {
        executor.execute {
            try {
                val conn = (URL("$serverUrl/api/android/version").openConnection() as HttpURLConnection).apply {
                    connectTimeout = 3000
                    readTimeout = 3000
                }
                if (conn.responseCode in 200..299) {
                    val body = conn.inputStream.bufferedReader().readText()
                    val json = JSONObject(body)
                    val remoteCode = json.optInt("versionCode", 0)
                    val remoteName = json.optString("versionName", "")
                    val apkPath = json.optString("apkUrl", "/api/android/apk")
                    if (remoteCode > BuildConfig.VERSION_CODE) {
                        runOnUiThread {
                            AlertDialog.Builder(this)
                                .setTitle("Atualização disponível (v$remoteName)")
                                .setMessage("Uma nova versão do Savano Cine Android está pronta no seu servidor.")
                                .setPositiveButton("Baixar APK") { _, _ ->
                                    val fullUrl = if (apkPath.startsWith("http")) apkPath else "$serverUrl$apkPath"
                                    val req = DownloadManager.Request(Uri.parse(fullUrl)).apply {
                                        setMimeType("application/vnd.android.package-archive")
                                        setTitle("SavanoCine-v$remoteName.apk")
                                        setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                                        setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, "SavanoCine-v$remoteName.apk")
                                    }
                                    val dm = getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
                                    dm.enqueue(req)
                                    Toast.makeText(this, "Download iniciado em Downloads", Toast.LENGTH_LONG).show()
                                }
                                .setNegativeButton("Depois", null)
                                .show()
                        }
                    }
                }
                conn.disconnect()
            } catch (_: Exception) {
                // ignore update check failures
            }
        }
    }

    private fun toggleSystemBars(show: Boolean) {
        val controller = WindowCompat.getInsetsController(window, window.decorView)
        controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        if (show) {
            controller.show(WindowInsetsCompat.Type.systemBars())
        } else {
            controller.hide(WindowInsetsCompat.Type.systemBars())
        }
    }

    companion object {
        const val EXTRA_SERVER_URL = "server_url"
    }
}
