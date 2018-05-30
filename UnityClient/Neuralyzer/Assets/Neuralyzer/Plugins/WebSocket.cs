using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Collections;
using System.Collections.Concurrent;
using UnityEngine;
using System.Runtime.InteropServices;
using FlatBuffers;
using Neuralyzer.Core;
using Neuralyzer.Transport.FlatBuffers;
using UnityEngine.Events;

#if UNITY_METRO && !UNITY_EDITOR
using Buffer = Windows.Storage.Streams.Buffer;
using System.Threading.Tasks;
using System.Runtime.InteropServices.WindowsRuntime;
using System.Threading;
using Windows.Storage.Streams;
using Windows.Web;
using Windows.System.Threading;
using Windows.Networking.Sockets;
#endif

/// <summary>
/// Please only make use of the NeuraCore class as this one is highly build dependent and changes to this may break when actually built and work while in the editor
/// </summary>

#region SupportClasses
public enum Opcode
{
  TEXT,
  BINARY
};

public class CloseEventArgs : EventArgs
{
  public ushort Code { get; set; }
  public string Reason { get; set; }
  public bool WasClean { get; set; }
}

public class ErrorEventArgs : EventArgs
{
  public string Message;

  public ErrorEventArgs(string err)
  {
    Message = err;
  }
}

public class MessageEventArgs : EventArgs
{
  public string Data = null;
  public byte[] RawData = null;
  public Opcode Type
  {
    get
    {
      return RawData == null ? Opcode.TEXT : Opcode.BINARY;
    }
  }

  public MessageEventArgs(string data)
  {
    Data = data;
  }

  public MessageEventArgs(byte[] data)
  {
    RawData = data;
  }

} 
#endregion

public class WebSocket
{
    private Uri mUrl;
    public event EventHandler<CloseEventArgs> OnClose;
    public event EventHandler<ErrorEventArgs> OnError;
    public event EventHandler<MessageEventArgs> OnMessage;
    public event EventHandler OnOpen;
    public bool isConnected = false;

    public void SendArray(byte[] arr)
    {
        Send(arr);
    }

    public void SendString(string blip)
    {
        SendArray(Encoding.UTF8.GetBytes(blip));
    }
    //public string RecvString()
    //{
    //  throw new NotImplementedException();
    //}

    public byte[] RecvArray()
    {
        return Recv();
    }

#if UNITY_WEBGL && !UNITY_EDITOR

    public WebSocket(string url)
	{
		mUrl = new Uri(url);

		string protocol = mUrl.Scheme;
		if (!protocol.Equals("ws") && !protocol.Equals("wss"))
			throw new ArgumentException("Unsupported protocol: " + protocol);
	}

	[DllImport("__Internal")]
	private static extern int SocketCreate (string url);

	[DllImport("__Internal")]
	private static extern int SocketState (int socketInstance);

	[DllImport("__Internal")]
	private static extern void SocketSend (int socketInstance, byte[] ptr, int length);

	[DllImport("__Internal")]
	private static extern void SocketRecv (int socketInstance, byte[] ptr, int length);

	[DllImport("__Internal")]
	private static extern int SocketRecvLength (int socketInstance);

	[DllImport("__Internal")]
	private static extern void SocketClose (int socketInstance);

	[DllImport("__Internal")]
	private static extern int SocketError (int socketInstance, byte[] ptr, int length);

	int m_NativeRef = 0;

	public void Send(byte[] buffer)
	{
		SocketSend (m_NativeRef, buffer, buffer.Length);
	}

	public byte[] Recv()
	{
		int length = SocketRecvLength (m_NativeRef);
		if (length == 0)
			return null;
		byte[] buffer = new byte[length];
		SocketRecv (m_NativeRef, buffer, length);
    if(OnMessage != null) OnMessage.Invoke(this,new MessageEventArgs(buffer));
		return buffer;
	}

	public IEnumerator Connect()
	{
		m_NativeRef = SocketCreate (mUrl.ToString());

		while (SocketState(m_NativeRef) == 0)
			yield return 0;
    if(SocketState(m_NativeRef) == 1)
    {
      if(OnOpen != null) OnOpen.Invoke(this,new EventArgs());
      isConnected = true;
    }
	}
 
	public void Close(string closeMessage = null)
	{
      isConnected = false;
		SocketClose(m_NativeRef);
        if(OnClose != null) OnClose.Invoke(this,new CloseEventArgs {Reason =
closeMessage?? "Closed due to user request." });
	}

	public string error
	{
		get {
			const int bufsize = 1024;
			byte[] buffer = new byte[bufsize];
			int result = SocketError (m_NativeRef, buffer, bufsize);

			if (result == 0)
				return null;
      string eMsg = Encoding.UTF8.GetString (buffer);
      if(OnError != null) OnError.Invoke(this,new ErrorEventArgs(eMsg));
			return eMsg;		
		}
	}
#elif UNITY_EDITOR

    public WebSocket(string url)
    {

        mUrl = new Uri(url);

        string protocol = mUrl.Scheme;
        if (!protocol.Equals("ws") && !protocol.Equals("wss"))
            throw new ArgumentException("Unsupported protocol: " + protocol);
    }

    WebSocketSharp.WebSocket m_Socket;
    Queue<byte[]> m_Messages = new Queue<byte[]>();
    bool m_IsConnected = false;
    string m_Error = null;

    public IEnumerator Connect()
    {
        m_Socket = new WebSocketSharp.WebSocket(mUrl.ToString());
        m_Socket.OnMessage += (sender, e) =>
        {
            m_Messages.Enqueue(e.RawData);
        };
        m_Socket.OnOpen += (sender, e) =>
        {
            m_IsConnected = true;
            isConnected = true;
        };
        m_Socket.OnError += (sender, e) =>
        {
            m_Error = e.Message;
            if (OnError != null) OnError.Invoke(this, new ErrorEventArgs(m_Error));
        };
        m_Socket.ConnectAsync();
        while (!m_IsConnected && m_Error == null)
            yield return 0;
        if (OnOpen != null) OnOpen.Invoke(this, new EventArgs());
    }

    public void Send(byte[] buffer)
    {
        m_Socket.Send(buffer);
    }

    public byte[] Recv()
    {
        if (m_Messages.Count == 0)
            return null;
        byte[] mDeq = m_Messages.Dequeue();
        if (OnMessage != null) OnMessage.Invoke(this, new MessageEventArgs(mDeq));
        return mDeq;
    }

    public void Close(string closeMessage = null)
    {
        isConnected = false;
        m_Socket.Close();
        if (OnClose != null)
            OnClose.Invoke(this, new CloseEventArgs {Reason = closeMessage ?? "Closed due to user request."});
    }

    public string error
    {
        get { return m_Error; }
    }

#elif UNITY_METRO && !UNITY_EDITOR
    MessageWebSocket socket;

    Uri url;
    DataWriter MessageWriter;
    Mutex SendLock;
    Queue<byte[]> m_Messages = new Queue<byte[]>();

    private readonly ConcurrentQueue<MessageEventArgs> unprocessedMessageEvents =
        new ConcurrentQueue<MessageEventArgs>();

    private bool isClosing = false;

    public WebSocket(string url)
    {
        this.url = TryGetUri(url);
        socket = new MessageWebSocket();
        socket.MessageReceived += OnMessageRecieved;
        socket.Closed += OnClosed;
        MessageWriter = new DataWriter(socket.OutputStream);
        SendLock = new Mutex();
        string protocol = this.url.Scheme;
        if (!protocol.Equals("ws") && !protocol.Equals("wss"))
            throw new ArgumentException("Unsupported protocol: " + protocol);
    }

    public bool IsAlive
    {
        get { return true; }
    }

    public byte[] Recv()
    {
        if (m_Messages.Count == 0)
            return null;
        return m_Messages.Dequeue();
    }

    void OnMessageRecieved(MessageWebSocket FromSocket, MessageWebSocketMessageReceivedEventArgs InputMessage)
    {
        UnityEngine.WSA.Application.InvokeOnAppThread(() =>
        {
            try
            {

                MessageEventArgs OutputMessage = null;
                var dr = InputMessage.GetDataReader();

                if (InputMessage.MessageType == SocketMessageType.Utf8)
                {
                    var stringLength = dr.UnconsumedBufferLength;
                    string receivedMessage = dr.ReadString(stringLength);
                    OutputMessage = new MessageEventArgs(receivedMessage);
                }
                else
                {
                    var buf = new byte[dr.UnconsumedBufferLength];
                    dr.ReadBytes(buf);
                    OutputMessage = new MessageEventArgs(buf);
                }
                unprocessedMessageEvents.Enqueue(OutputMessage);
            }
            catch (Exception e)
            {
                OnError?.Invoke(this, new ErrorEventArgs("Socket recieve error: " + e.Message));
            }
        }, false);
    }



    async Task SendAsyncTask(string message)
    {
        //	"flush before changing type"
        await MessageWriter.FlushAsync();
        socket.Control.MessageType = SocketMessageType.Utf8;
        MessageWriter.WriteString(message);
        await MessageWriter.StoreAsync();
    }

    async Task SendAsyncTask(byte[] Data)
    {
        try
        {
            if (isClosing)
                return;
            //	"flush before changing type"
            await MessageWriter.FlushAsync();
            socket.Control.MessageType = SocketMessageType.Binary;
            MessageWriter.WriteBytes(Data);
            await MessageWriter.StoreAsync();
        }
        catch (Exception e)
        {
            OnError?.Invoke(this, new ErrorEventArgs("Socket send error: " + e.Message));
        }
    }

    public void Send(string data)
    {
        lock (SendLock)
        {
            var SendTask = SendAsyncTask(data);
            SendTask.Wait();
        }
        ;
    }

    public void Send(byte[] data)
    {
        lock (SendLock)
        {
            var SendTask = SendAsyncTask(data);
            SendTask.Wait();
        }
        ;
    }

    //public void SendAsync(string data, Action<bool> completed)
    //{
    //    ThreadPool.RunAsync((Handler) =>
    //    {
    //        lock (SendLock)
    //        {
    //            var SendTask = SendAsyncTask(data);
    //            SendTask.Wait();
    //            completed.Invoke(true);
    //        }
    //        ;
    //        //await Send_Async(data);
    //    });
    //    //	todo: launch a task, wait and then send completed
    //    //completed.Invoke(true);
    //}

    //public void SendAsync(byte[] data, Action<bool> completed)
    //{
    //    ThreadPool.RunAsync((Handler) =>
    //    {
    //        lock (SendLock)
    //        {
    //            var SendTask = SendAsyncTask(data);
    //            SendTask.Wait();
    //            completed.Invoke(true);
    //        }
    //        ;
    //        //await Send_Async(data);
    //    });


    //    //completed.Invoke(true);
    //}

    public IEnumerator Connect()
    {
        ConnectAsync();
        while (!isConnected || NeuraCore.isPaused)
        {
            yield return new WaitForSeconds(.1f);
        }
        isConnected = true;
        yield return 0;
    }

    public void ConnectAsync()
    {
        StartAsync();
    }

    public void Close(string closeMessage = null)
    {
        isClosing = true;
        MessageWriter = null;
        if (socket != null)
        {
            try
            {
                socket.Close(1000, closeMessage ?? "Closed due to user request.");
                //socket.Dispose();
                socket = null;
            }
            catch (Exception ex)
            {
                OnError?.Invoke(this, new ErrorEventArgs(ex.Message));
                socket.Dispose();
                socket = null;
            }
        }
    }

    void OnClosed(IWebSocket Socket, WebSocketClosedEventArgs Event)
    {
        UnityEngine.WSA.Application.InvokeOnAppThread(() =>
        {
            isConnected = false;
            if (!NeuraCore.isPaused)
                OnClose?.Invoke(this, new CloseEventArgs {Reason = Event.Reason});
        }, false);
    }

    void OnRecvData(byte[] Data)
    {

    }

    static Uri TryGetUri(string uriString)
    {
        Uri webSocketUri;
        if (!Uri.TryCreate(uriString.Trim(), UriKind.Absolute, out webSocketUri))
            throw new Exception("Error: Invalid URI");

        // Fragments are not allowed in WebSocket URIs.
        if (!String.IsNullOrEmpty(webSocketUri.Fragment))
            throw new Exception("Error: URI fragments not supported in WebSocket URIs.");

        // Uri.SchemeName returns the canonicalized scheme name so we can use case-sensitive, ordinal string
        // comparison.
        if ((webSocketUri.Scheme != "ws") && (webSocketUri.Scheme != "wss"))
            throw new Exception("Error: WebSockets only support ws:// and wss:// schemes.");

        return webSocketUri;
    }

    async Task StartAsync()
    {
        /*	
        // If we are connecting to wss:// endpoint, by default, the OS performs validation of
        // the server certificate based on well-known trusted CAs. We can perform additional custom
        // validation if needed.
        if (SecureWebSocketCheckBox.IsChecked == true)
        {
            // WARNING: Only test applications should ignore SSL errors.
            // In real applications, ignoring server certificate errors can lead to Man-In-The-Middle
            // attacks. (Although the connection is secure, the server is not authenticated.)
            // Note that not all certificate validation errors can be ignored.
            // In this case, we are ignoring these errors since the certificate assigned to the localhost
            // URI is self-signed and has subject name = fabrikam.com
            streamWebSocket.Control.IgnorableServerCertificateErrors.Add(ChainValidationResult.Untrusted);
            streamWebSocket.Control.IgnorableServerCertificateErrors.Add(ChainValidationResult.InvalidName);
            // Add event handler to listen to the ServerCustomValidationRequested event. This enables performing
            // custom validation of the server certificate. The event handler must implement the desired
            // custom certificate validation logic.
            streamWebSocket.ServerCustomValidationRequested += OnServerCustomValidationRequested;
            // Certificate validation is meaningful only for secure connections.
            if (server.Scheme != "wss")
            {
                AppendOutputLine("Note: Certificate validation is performed only for the wss: scheme.");
            }
        }
        */

        try
        {
            Debug.LogError("Starting Async Connect");
            await socket.ConnectAsync(url);
            isConnected = true;
        }
        catch (Exception ex) // For debugging
        {
            socket.Dispose();
            socket = null;

            OnError.Invoke(this, new ErrorEventArgs(ex.Message));
            return;
        }
        OnOpen?.Invoke(this, null);
    }

    public IEnumerator ProcessMessages()
    {
        var w = new WaitForEndOfFrame();
        while (Application.isPlaying)
        {
            if (unprocessedMessageEvents.Count > 0)
            {
                MessageEventArgs toProcess;
                unprocessedMessageEvents.TryDequeue(out toProcess);
                if (toProcess == null)
                {
                    continue;
                }
                m_Messages.Enqueue(toProcess.RawData);
                OnMessage?.Invoke(this, toProcess);
            }

            yield return w;
        }
    }
#endif

}
