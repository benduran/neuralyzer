using System;
using System.Collections;
using System.Collections.Generic;
using System.Text;
using FlatBuffers;
using Neuralyzer.Components;
using Neuralyzer.Transport;
using Neuralyzer.Transport.FlatBuffers;
using Newtonsoft.Json;
using UnityEngine;
using UnityEngine.VR.WSA;
using Random = UnityEngine.Random;

namespace Neuralyzer.Core
{
    /// <summary>
    /// Handles all interaction with the actual websocket. 
    /// </summary>
    public class NeuraCore : MonoBehaviour
    {
        #region Singleton pattern

        public static NeuraCore Instance
        {
            get
            {
                if (instance)
                    return instance;
                GameObject o = Instantiate(Resources.Load("Neuralyzer/Core")) as GameObject;
                if (o != null)
                    return instance ?? (instance = o
                               .GetComponent<NeuraCore>());
                return null;
            }
        }

        private static NeuraCore instance;

        #endregion

        [Tooltip("Configuration for your neuralyzer server")] public NeuralyzerConfig config;
        [Tooltip("for debugging. do not change, may break your connection")] public ConnectionState connectionState;

        #region Internal variables

        internal WebSocket socket;
        internal WaitForSeconds tickWait;
        private WaitForEndOfFrame eof;
        private bool isActive;
        private byte[] updateArray;
        private string connectionString;
        internal Queue<ErrorEventArgs> errorEventArgs = new Queue<ErrorEventArgs>();
        private float lastPulse = float.MaxValue;
        private float reconnectTime = 0.1f;
        private int reconnectAttempts;
        private Coroutine timeoutCoroutine;
        private Coroutine triggerReconnect;
        private byte[] initialStateArray;
        internal string sid;
        internal string uid;
        internal static bool isPaused = false;
      private string lastRoomJoined;

      #endregion

        // called when the websocket connection is gracefully closed, or after the connection times out after a hard disconnect
        public event EventHandler<CloseEventArgs> OnClose;

        // called the frame after an error occurs due to some websocket implementations being handled on separate threads, and the ability to call unity functions is desired
        public event EventHandler<ErrorEventArgs> OnError;

        // processed in order after being added to a queue by the socket. this is called when the message is processed NOT when it is received
        public event EventHandler<MessageEventArgs> OnMessage;

        // called when a socket is successfully opened
        public event EventHandler OnOpen;

        /// <summary>
        /// Any message stored here will be picked up during the next client tick and sent to the server, then this will be cleared
        /// </summary>
        /// <param name="updateVal">string to be sent to server. typically json encoded</param>
        public void SetUpdate(byte[] updateVal)
        {
            if (updateArray != null && updateArray.Length > 0 && connectionState != ConnectionState.Connected)
                return;
            updateArray = updateVal;
        }

        public void SendInitialState(byte[] initialVal)
        {
            if (initialStateArray != null && initialVal.Length > 0)
            {
                print("initial state string not empty");
            }
            initialStateArray = initialVal;
        }

        public void JoinRoom(string roomName, string userName)
        {
            uid = Guid.NewGuid().ToString();
#if UNITY_METRO
      var devType = "hololens";
#else
      var devType = "browser"; 
#endif
      lastRoomJoined = roomName;
            socket.SendArray(ServerMessageFactory.BuildMessage(roomName, userName, uid,
                devType));
            print("join request sent");
        }

        private void Awake()
        {
#if UNITY_METRO
      WorldManager.OnPositionalLocatorStateChanged += WorldManager_OnPositionalLocatorStateChanged; 
#endif
      instance = this;
            Application.runInBackground = true;
            if (!config)
            {
                Debug.LogError("Config is required");
            }
            //DontDestroyOnLoad(gameObject);
            tickWait = new WaitForSeconds(1 / (float) config.UpdateHz);
            eof = new WaitForEndOfFrame();
        }

        /// <summary>
        /// poll for error processing
        /// this is because errors can come from a different thread
        /// </summary>
        private void Update()
        {
            if (errorEventArgs.Count <= 0) return;
            ErrorEventArgs error = errorEventArgs.Dequeue();
            if (socket != null)
            {
                socket.Close("Socket Error");
                socket = null;
            }
            connectionState = ConnectionState.Disconnected;
      if (OnClose != null)
            {
                OnClose.Invoke(this, new CloseEventArgs
                {
                    Reason = "Socket Error: socket already closed",
                    WasClean = false
                });
            }
            if (OnError != null) OnError.Invoke(this, error);
        }

        private IEnumerator Start()
        {
            WaitForEndOfFrame w = new WaitForEndOfFrame();
            if (config.ConnectOnStart)
            {
                StartCoroutine(Connect());
            }

            while (socket == null || !socket.isConnected)
            {
                yield return w;
            }

            isActive = true;
            StartCoroutine(Receive());
            StartCoroutine(Send());
        }

        public IEnumerator Connect(string sid = "")
        {
            var w = new WaitForEndOfFrame();
            while (isPaused)
            {
                yield return w;
            }
            if (connectionState == ConnectionState.Disconnected)
            {
                socket = null;
                connectionState = ConnectionState.Connecting;
                Debug.Log("Connecting...");
                socket = new WebSocket(config.ConnectionEndpoint + ":" + config.Port + "/live" +
                                       (!string.IsNullOrEmpty(sid) ? "?sid=" + sid : ""));
                socket.OnClose += (sender, e) =>
                {
                    print("Closed socket");
                    connectionState = ConnectionState.Disconnected;
                    if (timeoutCoroutine != null)
                        StopCoroutine(timeoutCoroutine);
                    if (e.Reason != "Closed due to user request.")
                    {
                      print("Triggering reconnect");
                      NeuraManager.Instance.TriggerAutoJoin();
                    triggerReconnect = StartCoroutine(TriggerReconnect());
                    }
                    else
                    {
                        sid = "";
                    }
                    if (OnClose != null) OnClose.Invoke(sender, e);
                };
                socket.OnError += (sender, e) =>
                {
                    errorEventArgs.Enqueue(e);
                };
                socket.OnMessage += (sender, e) =>
                {
                    var bb = new ByteBuffer(e.RawData);
                    var desMsg = ServerMessage.GetRootAsServerMessage(bb);
                    // handle heartbeat
                    if (desMsg.Type == msgType.SocketPulse)
                    {
                        lastPulse = Time.realtimeSinceStartup;
                        reconnectAttempts = 0;
                        reconnectTime = 0.1f;
                        socket.SendArray(ServerMessageFactory.BuildMessage());
                        return;
                    }
                    if (OnMessage != null) OnMessage.Invoke(sender, e);
                };
                socket.OnOpen += (sender, e) =>
                {
                    lastPulse = float.MaxValue;
                    timeoutCoroutine = StartCoroutine(TimeoutHandler());
                    if (triggerReconnect != null)
                        StopCoroutine(triggerReconnect);
                    if (OnOpen != null) OnOpen.Invoke(sender, e);
                };
                yield return StartCoroutine(socket.Connect());
#if UNITY_METRO && !UNITY_EDITOR // because messages are received on another thread they need to be processed in a different way than on webgl or in editor
                StartCoroutine(socket.ProcessMessages());
#endif
            }
        }

        public void ForceClosed()
        {
            print("Force Closed socket");
            connectionState = ConnectionState.Disconnected;
            if (timeoutCoroutine != null)
                StopCoroutine(timeoutCoroutine);

            if (OnClose != null)
                OnClose.Invoke(this, new CloseEventArgs
                {
                    Reason = "Closed due to user request.",
                    WasClean = false
                });
        }

        public void Disconnect()
        {
            if (socket != null) socket.Close();
        }

        private IEnumerator TriggerReconnect()
        {
            yield return new WaitForEndOfFrame();
            if(isPaused)
                yield return new WaitForEndOfFrame();
            while (config.AutoReconnectCount > reconnectAttempts)
            {
                Debug.Log("Attempting reconnect");
                reconnectAttempts++;
                yield return new WaitForSeconds(reconnectTime);
                if (reconnectTime < 10f)
                    reconnectTime *= 10;
                yield return StartCoroutine(Connect());//sid));
            }
            Debug.LogError("Full time out, check your network connection");
        }

        private IEnumerator TimeoutHandler()
        {
            WaitForEndOfFrame w = new WaitForEndOfFrame();
            while (Application.isPlaying)
            {
                if (isPaused)
                    yield return w;
                if (Time.realtimeSinceStartup - lastPulse > config.TimeOut && Application.isFocused)
                {
                    Debug.LogError("System Timeout");
                    socket.Close("System Timeout");
                    break;
                }
                yield return w;
            }
        }


        private IEnumerator Receive()
        {
            while (isActive)
            {
                if (isPaused) yield return eof;
                while (socket == null || !socket.isConnected)
                {
                    yield return eof;
                }
                //receive information as soon as possible
                socket.RecvArray();
                yield return eof;
            }
        }

        private IEnumerator Send()
        {
            while (isActive)
            {
                if (isPaused) yield return eof;
                if (initialStateArray != null && initialStateArray.Length > 0)
                {
                    print("initial state being sent to server " + initialStateArray);
                    socket.SendArray(initialStateArray);
                    initialStateArray = null;
                    yield return tickWait;
                    continue;
                }
                // send out delta state changes every tick
                if (updateArray != null && updateArray.Length > 0 && connectionState == ConnectionState.Connected)
                {
#if UNITY_EDITOR //print(updateString);
#endif
                    socket.SendArray(updateArray);
                    updateArray = null;
                }
                yield return tickWait;
            }
        }

#if UNITY_METRO // lets us enter a paused state if the hololens loses tracking
    private void WorldManager_OnPositionalLocatorStateChanged(PositionalLocatorState oldState, PositionalLocatorState newState)
    {
      isPaused = newState != PositionalLocatorState.Active;
    } 
#endif

    private void OnApplicationQuit()
        {
            //if there is an active socket close it. without this unity will crash if you try to play in editor after stopping.
            Disconnect();
            StopAllCoroutines();
        }
    }

    public enum ConnectionState : byte
    {
        Disconnected,
        Connecting,
        Connected,
        Disconnecting
    }
}
