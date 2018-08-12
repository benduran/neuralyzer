using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using FlatBuffers;
using Neuralyzer.Core;
using Neuralyzer.Transport;
using Neuralyzer.Transport.FlatBuffers;
using Newtonsoft.Json;
using UnityEngine;
using InitialState = Neuralyzer.Transport.InitialState;

namespace Neuralyzer.Components
{
    public class NeuraManager : MonoBehaviour
    {
        public static NeuraManager Instance;

        public RoomStateGen globalState;
        public float deltaTolerance;
        public string localUserName;

        public string localUserId
        {
            get { return NeuraCore.Instance.uid; }
        }

        public List<string> prefabNames;
        public List<GameObject> prefabs;


        #region Bridge

        public event EventHandler OnConnected;
        public event Action<object, UserJoinedEventArgs> OnUserJoined;
        public event Action<object, ErrorMessageEventArgs> OnErrorEvent;
        public event Action<object, UserLeftEventArgs> OnUserLeft;
        public event Action<object, PropertiesChangedEventArgs> OnPropertiesChanged;
        public event Action<object, List<string>> OnRoomsListChanged;
        public event Action<object, string> OnRoomJoined;
        public event Action<object, string> OnRoomCreated;
        public event EventHandler OnClosed;

        public bool inRoom;
        public string RoomName;
        public List<string> UsersInRoom;
        public List<string> RoomsAvailable;
        public bool ServerIsUp;
        #endregion

        private float updateTime = float.MaxValue;
        private float lastUpdate;

        private Dictionary<int, ITrackable> trackers;

        private List<RoomObjectObj> newRoomObjects;
        private RoomStateGen oldStateGen;
        private List<GameObject> roomCreatedObjects;

        private string requestedSiteDrive;
        private TargetPlacementObject requestedPoi;
        private AnnotationObject requestedAnnotation;
        private List<AnnotationObject> requestedAnnotationDeletions;
        private string oldSiteDrive = "";

        private void Awake()
        {
            Instance = this;
            trackers = new Dictionary<int, ITrackable>();
            newRoomObjects = new List<RoomObjectObj>();
            UsersInRoom = new List<string>();
            RoomsAvailable = new List<string>();
            roomCreatedObjects = new List<GameObject>();
        }

        public IEnumerator Start()
        {
            globalState = new RoomStateGen();
            WaitForEndOfFrame w = new WaitForEndOfFrame();
            NeuraCore.Instance.OnError += ErrorHandler;
            NeuraCore.Instance.OnClose += CloseHandler;
            NeuraCore.Instance.OnOpen += OpenHandler;
            NeuraCore.Instance.OnMessage += MessageHandler;
            InvokeRepeating("RefreshRoomList", 0.1f, 2f);
            while (NeuraCore.Instance.socket == null)
            {
                yield return w;
            }
            updateTime = 1f / NeuraCore.Instance.config.UpdateHz;
        }

        #region Event Handlers

        private void MessageHandler(object sender, MessageEventArgs e)
        {
            var bb = new ByteBuffer(e.RawData);

            ServerMessage msg = ServerMessage.GetRootAsServerMessage(bb);
            switch (msg.Type)
            {
                case msgType.RoomStateUpdate:
                    //handle message
                    if (msg.Data<StateUpdate>() == null)
                    {
                        print("empty state update. this should not happen");
                        return;
                    }
                    StateUpdate? stateUpdate = msg.Data<StateUpdate>();
                    if (stateUpdate != null)
                    {
                        StateUpdate sup =
                            stateUpdate.Value;
                        UpdateLocalState(sup);
                    }
                    break;
                case msgType.SocketReady:
                    print("connected to server");
                    StringData? stringData = msg.Data<StringData>();
                    if (stringData != null)
                    {
                        OnConnectedArgs connectedEventArgs = new OnConnectedArgs
                        {
                            sid = stringData.Value.Data,
                        };
                        NeuraCore.Instance.sid = connectedEventArgs.sid;
                    }
                    if (OnConnected != null) OnConnected.Invoke(this, new EventArgs());
                    break;
                case msgType.SocketRoomJoined:
                {
                    print("Joined room ");
                    inRoom = true;
                    UsersInRoom.Add(localUserName);
                    NeuraCore.Instance.connectionState = ConnectionState.Connected;
                    if (msg.DataType != Transport.FlatBuffers.msg.StateUpdate)
                        return;
                    if (msg.Data<StateUpdate>().HasValue)
                    {
                        var initStateSUP = msg.Data<StateUpdate>().Value;
                        UpdateLocalState(initStateSUP);
                    }
                    if (OnRoomJoined != null) OnRoomJoined.Invoke(this, RoomName);
                }
                    break;
                case msgType.RoomCreated:
                    StringData? createMsg = msg.Data<StringData>();
                    if (createMsg != null)
                    {
                        //var rmName = createMsg.Value.Data;
                        //RoomName = rmName;
                        print("room " + RoomName + " has been created");
                        if (OnRoomCreated != null) OnRoomCreated.Invoke(this, RoomName);
                        if (string.IsNullOrEmpty((globalState ?? (globalState = new RoomStateGen())).siteDrive))
                        {
                            //Handle things like critical room state here to make sure that the initial state sent has the required information
                            //For onsight the site drive is of critical importance so we are setting it below
                            //globalState.siteDrive = string.IsNullOrEmpty(requestedSiteDrive)
                            //    ? MultiUserConnectionManager.Instance.CurrentSiteDriveJSON
                            //    : requestedSiteDrive;
                        }
                        Debug.Assert(!string.IsNullOrEmpty(globalState.siteDrive));

                        NeuraCore.Instance.SendInitialState(ServerMessageFactoryFB.BuildMessage(globalState));
                    }
                    break;
                case msgType.RoomUserOnjoined:
                    StringData? joinedMsg = msg.Data<StringData>();
                    if (joinedMsg != null)
                    {
                        var user = joinedMsg.Value.Data;
                        print(user + " has joined the room");
                        UsersInRoom.Add(user);
                        if (OnUserJoined != null)
                            OnUserJoined.Invoke(this, new UserJoinedEventArgs
                            {
                                username = user
                            });
                    }
                    break;
                case msgType.RoomUserOnLeft:
                    StringData? leftMsg = msg.Data<StringData>();
                    if (leftMsg != null)
                    {
                        var user = leftMsg.Value.Data;
                        print(user + " has left the room");
                        if (UsersInRoom.Contains(user))
                            UsersInRoom.Remove(user);
                        if (OnUserLeft != null)
                            OnUserLeft.Invoke(this, new UserLeftEventArgs
                            {
                                username = user
                            });
                    }
                    break;
            }
        }

        private void OpenHandler(object sender, EventArgs e)
        {
            Debug.Log("Socket connection opened");
        }

        private void CloseHandler(object sender, CloseEventArgs e)
        {
            inRoom = false;
            foreach (KeyValuePair<int, ITrackable> pair in trackers)
            {
                if (globalState.objects.Any(o => o.id == pair.Key))
                    globalState.objects.Remove(globalState.objects.First(tr => tr.id == pair.Key));
            }
            trackers.Clear();
            for (int i = 0; i < roomCreatedObjects.Count; i++)
            {
                Destroy(roomCreatedObjects[i]);
            }
            roomCreatedObjects.Clear();
            if (OnClosed != null) OnClosed.Invoke(this, new EventArgs());
            Debug.Log("SocketClosed. Reason: " + e.Reason);
        }

        private void ErrorHandler(object sender, ErrorEventArgs e)
        {
            Debug.LogError(e.Message);
        }

        #endregion

        public void JoinRoom(string roomToJoin, string userName)
        {
            Debug.Assert(!string.IsNullOrEmpty(userName), "Username cannot be null or empty");
            RoomName = roomToJoin;
            localUserName = userName;

            if (NeuraCore.Instance.socket == null || !NeuraCore.Instance.socket.isConnected)
            {
                print("Not connected, trying to auto connect");
                OnConnected += AutoJoinRoom;
                Connect();
                return;
            }
            if (inRoom)
            {
                print("Cannot join room when already in one");
                return;
            }
            globalState = new RoomStateGen();
            requestedSiteDrive = "";
            requestedPoi = new TargetPlacementObject();
            requestedAnnotation = new AnnotationObject();
            requestedAnnotationDeletions = new List<AnnotationObject>();
            NeuraCore.Instance.JoinRoom(roomToJoin, userName);
        }

        public void CleanState()
        {
            NeuraCore.Instance.ForceClosed();
            foreach (KeyValuePair<int, ITrackable> trackable in trackers)
            {
                if (trackable.Value != null)
                    Destroy(((MonoBehaviour) trackable.Value).gameObject);
            }
            trackers = new Dictionary<int, ITrackable>();
            globalState = new RoomStateGen();
        }

        public void LeaveRoom()
        {
            if (!inRoom)
            {
                print("Cannot leave a room if you aren't in one");
                return;
            }
            RoomName = "";
            UsersInRoom = new List<string>();

            NeuraCore.Instance.Disconnect();
        }

        public bool AddSceneObject(ITrackable tracker)
        {
            if (trackers.ContainsKey(tracker.id))
                return false;
            trackers.Add(tracker.id, tracker);
            (globalState.objects ?? (globalState.objects = new List<RoomObjectObj>())).Add(tracker.ToRoomObject());
            newRoomObjects.Add(tracker.ToRoomObject());
            return true;
        }

        public void Connect()
        {
            print("Attempting to connect");
            StartCoroutine(NeuraCore.Instance.Connect());
        }

        public void RefreshRoomList()
        {
            StartCoroutine(refreshRooms());
        }

        /// <summary>
        /// Request neuralyzer to change the current scene
        /// </summary>
        /// <param name="newSD">The serialized information for the new site drive</param>
        /// <returns>returns whether neuralyzer will handle the scene change. Will return false if not in a room</returns>
        public bool RequestSiteDriveChange(string newSD)
        {
            //if (!overrideLoad)
            //  return true;
            print("is currently in a room " + inRoom);
            requestedSiteDrive = newSD;
            return inRoom;
        }

        /// <summary>
        /// Requests neuralyzer to place or move the poi.
        /// </summary>
        /// <param name="position">The proposed position of the POI</param>
        /// <returns>Returns whether neuralyzer has handled the request </returns>
        public bool RequestPOIPlacement(UnityEngine.Vector3 position)
        {
            if (!inRoom) // not in a room so do not handle this change
                return false;
            if (globalState.poiPlacementObject.isValid && globalState.poiPlacementObject.position == position)
                return true;

            requestedPoi = new TargetPlacementObject
            {
                id = 0,
                name = "POI",
                position = position,
                isValid = true
            };
            return true;
        }

        public bool RequestAddAnnotation(AnnotationObject newAnno)
        {
            if (!inRoom) // not in a room so do not handle this change
                return false;

            //update local state
            if (globalState.annotationObjects != null &&
                globalState.annotationObjects.Any(ao => ao.lineId == newAnno.lineId))
            {
                globalState.annotationObjects[
                    globalState.annotationObjects.IndexOf(
                        globalState.annotationObjects.Single(ao => ao.lineId == newAnno.lineId))] = newAnno;
            }
            else
            {
                (globalState.annotationObjects ?? (globalState.annotationObjects =
                     new List<AnnotationObject>())).Add(newAnno);
            }

            requestedAnnotation = newAnno;
            return true;
        }

        public bool RequestDeleteAnnotation(string lineId)
        {
            if (!inRoom) // not in a room so do not handle this change
                return false;

            if (globalState.annotationObjects.Any(ao => ao.lineId == lineId))
            {
                (requestedAnnotationDeletions ?? (requestedAnnotationDeletions = new List<AnnotationObject>())).Add(
                    globalState.annotationObjects[
                        globalState.annotationObjects.IndexOf(
                            globalState.annotationObjects.Single(ao => ao.lineId == lineId))]);
            }
            return true;
        }

        internal void AddUserObject(int id, ITrackable toAdd)
        {
            print("adding object " + id);
            trackers.Add(id, toAdd);
            (globalState.objects ?? (globalState.objects = new List<RoomObjectObj>())).Add(toAdd.ToRoomObject());
            newRoomObjects.Add(toAdd.ToRoomObject());
        }

        internal void RemoveUserObject(int id)
        {
            if (trackers.ContainsKey(id))
            {
                trackers.Remove(id);
            }
            if (globalState.objects.Any(o => o.id == id))
                globalState.objects.Remove(globalState.objects.First(tr => tr.id == id));
        }

        private IEnumerator refreshRooms()
        {
            var request = new WWW(NeuraCore.Instance.config.ConnectionEndpoint.Replace("ws", "http") +
                                  (NeuraCore.Instance.config.Port != 0 ? ":" + NeuraCore.Instance.config.Port : "") +
                                  "/api/rooms"); //"https://neuralyzer-exp.hi.jpl.nasa.gov/api/rooms");
            yield return request;
            ServerIsUp = string.IsNullOrEmpty(request.error); //this lets us know if the server is currently up by assessing the return value from the rooms rest call
            if (request.text != "[]")
            {
                var temp = JsonConvert.DeserializeObject<List<InitialState>>(request.text);
                if (temp != null && temp.Count > 0)
                {
                    RoomsAvailable = temp.Select(i => i.name).ToList();
                }
                else
                {
                    RoomsAvailable.Clear();
                }
                if (OnRoomsListChanged != null) OnRoomsListChanged.Invoke(this, RoomsAvailable);
            }
            else
            {
                RoomsAvailable.Clear();
            }
        }

        private void UpdateLocalState(byte[] rawBytes)
        {
            var bb = new ByteBuffer(rawBytes);
            var sup = StateUpdate.GetRootAsStateUpdate(bb);
            UpdateLocalState(sup);
        }

        /// <summary>
        /// Updates the local copy of the global state via server delta
        /// </summary>
        /// <param name="serverUpdate">changes to the global state since last server tick</param>
        private void UpdateLocalState(StateUpdate serverUpdate)
        {
            RoomStateGen newRoomState = new RoomStateGen(globalState);

            #region properties update

            bool propsChanged = false;
            bool isSceneUpdate = false;
            if (!string.IsNullOrEmpty(serverUpdate.SiteDrive))
            {
                propsChanged = true;
                isSceneUpdate = true;
            }
            else
            {
                if (serverUpdate.AnnotationsLength > 0)
                {
                    propsChanged = true;
                }
                if (serverUpdate.Poi.HasValue)
                {
                    propsChanged = true;
                }
            }
            if (propsChanged)
            {
                if (isSceneUpdate)
                {
                    if (OnPropertiesChanged != null)
                        OnPropertiesChanged.Invoke(this, serverUpdate);
                }
                else
                {
                    serverUpdate.Debounce(this, props =>
                    {
                        if (OnPropertiesChanged != null)
                            OnPropertiesChanged.Invoke(this, props);
                    }, isSceneUpdate);
                }
            }

            #endregion

            if (serverUpdate.DeleteLength > 0) //delete these object ids from the global state
            {
                print("Deleting " + serverUpdate.DeleteLength + " objects");
                for (int i = 0; i < serverUpdate.DeleteLength; i++)
                {
                    if (newRoomState.objects.All(tr => tr.id != serverUpdate.Delete(i)))
                    {
                        print("object to delete not found in global state " + serverUpdate.Delete(i));
                        continue;
                    }
                    newRoomState.objects.Remove(globalState.objects.Single(o => o.id == serverUpdate.Delete(i)));
                    if (trackers.ContainsKey(serverUpdate.Delete(i)) && trackers[serverUpdate.Delete(i)] != null)
                    {
                        Destroy(((MonoBehaviour) trackers[serverUpdate.Delete(i)]).gameObject);
                    }
                    else
                    {
                        print("Could not find game object to destroy" + serverUpdate.Delete(i));
                    }
                }
            }
            if (serverUpdate.CreateLength > 0) //create these objects and add them to the global state
            {
                for (int i = 0; i < serverUpdate.CreateLength; i++)
                {
                    if (!serverUpdate.Create(i).HasValue)
                    {
                        print("Malformed create message");
                        continue;
                    }
                    if (!trackers.ContainsKey(serverUpdate.Create(i).Value.Id))
                    {
                        CreateObject(serverUpdate.Create(i).Value, newRoomState);

                        //if (newRoomState.objects.Contains(serverUpdate.Create(i).Value))
                        //continue;
                    }
                    else
                    {
                        print("Object " + serverUpdate.Create(i).Value.Id + " already exists");
                    }
                    //else
                    //{
                    //  if (newRoomState.objects.Any(tr => tr.id == serverUpdate.Create(i).Value.Id))
                    //    newRoomState.objects.Remove(newRoomState.objects.Single(o => o.id == serverUpdate.Create(i).Value.Id));
                    //  var oldObj = (MonoBehaviour) trackers[serverUpdate.Create(i).Value.Id];
                    //  if (oldObj) Destroy(oldObj.gameObject);
                    //  trackers.Remove(serverUpdate.Create(i).Value.Id);
                    //}
                    //CreateObject(serverUpdate.Create(i).Value, newRoomState);

                }
            }
            if (serverUpdate.UpdateLength > 0)
            {
                for (int i = 0; i < serverUpdate.UpdateLength; i++)
                {
                    if (!serverUpdate.Update(i).HasValue) continue;
                    if (!trackers.ContainsKey(serverUpdate.Update(i).Value.Id))
                    {
                        Debug.Log("Object created from update. please use the create function instead");
                        //CreateObject(serverUpdate.Update(i).Value, newRoomState);
                        continue;
                    }
                    trackers[serverUpdate.Update(i).Value.Id].UpdateFromRoomObject(serverUpdate.Update(i).Value);
                }
            }
            oldStateGen = new RoomStateGen(globalState);
            globalState = newRoomState;
        }

        /// <summary>
        /// Creates a local copy of a remote object
        /// </summary>
        /// <param name="newObj"></param>
        private void CreateObject(RoomObjectObj newObj, RoomStateGen state)
        {
            print("Creating object " + newObj.name);
            ITrackable tracker;
            GameObject go;
            if (prefabNames.Contains(newObj.prefab))
            {
                go = Instantiate<GameObject>(prefabs[prefabNames.IndexOf(newObj.prefab)]);
                tracker = go.GetComponent<ITrackable>();
            }
            else
            {
                go = new GameObject("Prefab " + newObj.prefab + " not found");
                tracker = go.AddComponent<NStateTracker>();
            }
            tracker.id = newObj.id;
            tracker.prefab = newObj.prefab;
            trackers.Add(tracker.id, tracker);
            state.objects.Add(newObj);
            roomCreatedObjects.Add(go);
            tracker.UpdateFromRoomObject(newObj);
        }

        /// <summary>
        /// Upload any changes in objects owned by the local player, in scene properties, or scene objects
        /// </summary>
        private void UploadGlobalState()
        {
            lastUpdate = Time.realtimeSinceStartup;
            if (!inRoom)
            {
                return;
            }

            List<RoomObjectObj> localObjectsUpdate = new List<RoomObjectObj>();

            StateUpdateObject diffState = null;

            #region Object Updates

            if (globalState.objects != null)
            {
                foreach (RoomObjectObj obj in globalState.objects)
                {
                    if (!trackers[obj.id].isLocal) continue;
                    if (!CompareObjects(obj, trackers[obj.id].ToRoomObject()))
                    {
                        localObjectsUpdate.Add(trackers[obj.id].ToRoomObject());
                    }
                }

                //update the local copy of the global state with the new values for player controlled and scene objects
                for (int i = 0; i < localObjectsUpdate.Count; i++)
                {
                    globalState.objects[globalState.objects.IndexOf(localObjectsUpdate[i])] = localObjectsUpdate[i];
                }

                if (localObjectsUpdate.Count != 0 || newRoomObjects.Count != 0)
                {
                    diffState = new StateUpdateObject {update = localObjectsUpdate};
                    if (newRoomObjects.Count > 0)
                        diffState.create = newRoomObjects;


                    newRoomObjects = new List<RoomObjectObj>();
                }
            }
            else
            {
                print("globalState has no objects");
            }


            #endregion

            #region Property Updates

            if (!string.IsNullOrEmpty(requestedSiteDrive)) //update scene
            {
                print("site drive changed in global");
                var mutState = diffState ?? (diffState = new StateUpdateObject());
                mutState.siteDrive = requestedSiteDrive;
                requestedSiteDrive = "";
                oldSiteDrive = "";
            }

            if (requestedPoi.isValid)
            {
                print("Setting requested poi");
                var mutState = diffState ?? (diffState = new StateUpdateObject());
                mutState.PlacePoi(requestedPoi);
                requestedPoi.isValid = false;
            }

            if (requestedAnnotation.isValid)
            {
                print("Adding requested annotation");
                var mutState = diffState ?? (diffState = new StateUpdateObject());
                mutState.AddAnnotation(requestedAnnotation);
                requestedAnnotation.isValid = false;
            }
            if (requestedAnnotationDeletions != null)
            {
                var mutState = diffState ?? (diffState = new StateUpdateObject());
                for (int i = 0; i < requestedAnnotationDeletions.Count; i++)
                {
                    var del = requestedAnnotationDeletions[i];
                    del.positions = new UnityEngine.Vector3[0];
                    del.isValid = true;
                    mutState.AddAnnotation(del);
                }
                requestedAnnotationDeletions = null;
            }

            #endregion

            if (diffState != null) //Serialize the updates to json and pass them to the NeuraCore to be sent to the server
            {
                NeuraCore.Instance.SetUpdate(ServerMessageFactoryFB.BuildMessage(diffState));
            }
            //Find all local owned and scene objects that have changed since the last tick
            oldStateGen = new RoomStateGen(globalState);
        }

        private void Update()
        {
            if (lastUpdate + updateTime < Time.realtimeSinceStartup)
            {
                UploadGlobalState();
            }
        }

        public void TriggerAutoJoin()
        {
            OnConnected += AutoJoinRoom;
        }

        private void AutoJoinRoom(object sender, EventArgs e)
        {
            print("auto joining room");
            NeuraCore.Instance.JoinRoom(RoomName, localUserName);
            OnConnected -= AutoJoinRoom;
        }

        private bool CompareObjects(RoomObjectObj d1, RoomObjectObj d2)
        {
            if (d1 == null)
            {
                return d2 == null;
            }
            if (d2 == null)
                return false;
            return d1.disposable == d2.disposable && d1.isHidden == d2.isHidden && d1.position == d2.position &&
                   d1.lookDirection == d2.lookDirection && d1.owner == d2.owner && d1.prefab == d2.prefab;
        }


        //Ended up not being used in onsight but a similar system could be used for handling user lists in the client. The room information was going to be parsed to find the names of participants
        //private IEnumerator refreshUsers() 
        //{
        //    var request = new WWW(NeuraCore.Instance.config.ConnectionEndpoint.Replace("ws", "http") +
        //                          (NeuraCore.Instance.config.Port != 0 ? ":" + NeuraCore.Instance.config.Port : "") +
        //                          "/api/room/:" + RoomName);
        //    yield return request;
        //}
    }
}
