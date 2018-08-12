using System;
using System.Linq;
using System.Collections.Generic;
using Assets.Neuralyzer.Scripts.Neuralyzer.Transport;
using FlatBuffers;
using Neuralyzer.Core;
using Neuralyzer.Transport.FlatBuffers;
using UnityEngine;
using Vector3 = UnityEngine.Vector3;

/// *********************************************************************************************************************
/// This file has some implementation specific code left in the project. This was done to give examples of how the flat buffer
/// creation can be implemented. If you want it is easy to simply ignore or delete the parts you are not using. The server message factory
/// should be modified to support your unique implementation. Additionally things like server update should be modified to support any changes
/// to schema in your implementation. For more information about flat buffers go to http://google.github.io/flatbuffers/
/// *********************************************************************************************************************
namespace Neuralyzer.Transport
{
    [Serializable]
    public class RoomStateGen
    {
        public TargetPlacementObject poiPlacementObject;
        public List<AnnotationObject> annotationObjects;
        public string siteDrive;
        public List<RoomObjectObj> objects;

        public RoomStateGen(RoomStateGen oldStateGen = null)
        {
            if (oldStateGen == null)
            {
                poiPlacementObject = new TargetPlacementObject();
                poiPlacementObject.isValid = false;
                annotationObjects = new List<AnnotationObject>();
                objects = new List<RoomObjectObj>();
                return;
            }
            poiPlacementObject = new TargetPlacementObject(oldStateGen.poiPlacementObject);
            annotationObjects = new List<AnnotationObject>(oldStateGen.annotationObjects);
            objects = new List<RoomObjectObj>(oldStateGen.objects);
        }
    }

    [Serializable]
    public class RoomObjectObj : IBufferable<RoomObject>
    {
        public int id;
        public Vector3 position;
        public Vector3 lookDirection;
        public bool disposable;
        public string owner = "";
        public string prefab = "";
        public bool isHidden;
        public string name;

        public static bool operator ==(RoomObjectObj r1, RoomObjectObj r2)
        {
            if (Equals(r1, null))
            {
                return Equals(r2, null);
            }
            if (Equals(r2, null))
                return false;
            return r1.id == r2.id;
        }

        public static bool operator !=(RoomObjectObj r1, RoomObjectObj r2)
        {
            return !(r1 == r2);
        }

        public Offset<RoomObject> ToBuffer(FlatBufferBuilder builder)
        {
            var objOwner = builder.CreateString(owner);
            var objName = builder.CreateString(name);
            var objPrefab = builder.CreateString(prefab);
            RoomObject.StartRoomObject(builder);
            RoomObject.AddId(builder, id);
            RoomObject.AddPosition(builder,
                FlatBuffers.Vector3.CreateVector3(builder, position.x, position.y, position.z));
            RoomObject.AddLookDirection(builder, FlatBuffers.Vector3.CreateVector3(builder,
                lookDirection.x, lookDirection.y, lookDirection.z));
            RoomObject.AddDisposable(builder, disposable);
            RoomObject.AddOwner(builder, objOwner);
            RoomObject.AddName(builder, objName);
            RoomObject.AddPrefab(builder, objPrefab);
            RoomObject.AddIsHidden(builder, isHidden);
            return RoomObject.EndRoomObject(builder);
        }

        public override bool Equals(object obj)
        {
            var o = obj as RoomObjectObj;
            return o != null && o.id == id;
        }

        public override int GetHashCode()
        {
            return id.GetHashCode();
        }

        public static implicit operator RoomObjectObj(RoomObject fbRoomObject)
        {
            return new RoomObjectObj
            {
                id = fbRoomObject.Id,
                owner = fbRoomObject.Owner,
                disposable = fbRoomObject.Disposable,
                position = fbRoomObject.Position.Value.ToUnityVector(),
                lookDirection = fbRoomObject.LookDirection.Value.ToUnityVector(),
                prefab = fbRoomObject.Prefab,
                isHidden = fbRoomObject.IsHidden,
                name = fbRoomObject.Name
            };
        }
    }

    [Serializable]
    public class StateUpdateObject : IBufferable<StateUpdate>
    {
        public TargetPlacementObject poiPlacementObject;
        public List<AnnotationObject> annotationObjects;
        public List<RoomObjectObj> create;
        public List<RoomObjectObj> update;
        public List<int> delete;
        public string siteDrive;

        public StateUpdateObject()
        {
            create = new List<RoomObjectObj>();
            update = new List<RoomObjectObj>();
            delete = new List<int>();
        }

        public void AddObject(RoomObjectObj newObj)
        {
            create.Add(newObj);
        }

        public void RemoveObject(RoomObjectObj remObj)
        {
            delete.Add(remObj.id);
        }

        public void UpdateObject(RoomObjectObj updObj)
        {
            if (update.Any(o => o.id == updObj.id))
            {
                update[update.IndexOf(updObj)] = updObj;
            }
            else
            {
                update.Add(updObj);
            }
        }

        public void PlacePoi(TargetPlacementObject newPoi)
        {
            poiPlacementObject = newPoi;
        }

        public void AddAnnotation(AnnotationObject annotation)
        {
            (annotationObjects ?? (annotationObjects = new List<AnnotationObject>())).Add(annotation);
        }

        public Offset<StateUpdate> ToBuffer(FlatBufferBuilder builder)
        {
            bool builtPoi = false;
            bool changedSiteDrive = false;
            StringOffset nsd = new StringOffset();
            if (!string.IsNullOrEmpty(siteDrive))
            {
                nsd = builder.CreateString(siteDrive);
                changedSiteDrive = true;
            }
            Offset<TargetPlacement> tPlacement = new Offset<TargetPlacement>();
            //build potential updates to the poi
            if (poiPlacementObject.isValid)
            {
                tPlacement = poiPlacementObject.ToBuffer(builder);
                builtPoi = true;
            }
            //build potential new/updated annotations
            List<Offset<Annotation>> aOffsets = new List<Offset<Annotation>>();
            if (annotationObjects != null)
            {
                for (int j = 0; j < annotationObjects.Count; j++)
                {
                    if (annotationObjects[j].isValid)
                    {
                        aOffsets.Add(annotationObjects[j].ToBuffer(builder));
                    }
                }
            }
            //build all created room objects
            List<Offset<RoomObject>> roOffsets = new List<Offset<RoomObject>>();
            for (int i = 0; i < create.Count; i++)
            {
                roOffsets.Add(create[i].ToBuffer(builder));
            }
            //build all updated room objects
            List<Offset<RoomObject>> ruOffsets = new List<Offset<RoomObject>>();
            for (int i = 0; i < update.Count; i++)
            {
                ruOffsets.Add(update[i].ToBuffer(builder));
            }
            //build vectors
            VectorOffset? deleteOffset = null;
            if (delete.Count > 0)
            {
                StateUpdate.StartDeleteVector(builder, delete.Count);
                for (int i = 0; i < delete.Count; i++)
                {
                    //builder.CreateString(delete[i]);
                    builder.AddInt(delete[i]);
                }
                deleteOffset = builder.EndVector();
            }
            VectorOffset? createOffset = null;
            if (roOffsets.Count > 0)
            {
                createOffset = StateUpdate.CreateCreateVector(builder, roOffsets.ToArray());
            }
            VectorOffset? updateOffset = null;
            if (ruOffsets.Count > 0)
            {
                updateOffset = StateUpdate.CreateUpdateVector(builder, ruOffsets.ToArray());
            }
            VectorOffset? annotationOffset = null;
            if (aOffsets.Count > 0)
            {
                annotationOffset = StateUpdate.CreateAnnotationsVector(builder, aOffsets.ToArray());
            }
            //actually build the buffer
            StateUpdate.StartStateUpdate(builder);
            if (changedSiteDrive) StateUpdate.AddSiteDrive(builder, nsd);
            if (builtPoi) StateUpdate.AddPoi(builder, tPlacement);
            if (annotationOffset != null) StateUpdate.AddAnnotations(builder, (VectorOffset) annotationOffset);
            if (createOffset != null) StateUpdate.AddCreate(builder, (VectorOffset) createOffset);
            if (updateOffset != null) StateUpdate.AddUpdate(builder, (VectorOffset) updateOffset);
            if (deleteOffset != null) StateUpdate.AddDelete(builder, (VectorOffset) deleteOffset);

            var sup = StateUpdate.EndStateUpdate(builder);
            return sup;
        }
    }

    [Serializable]
    public struct TrackedObject
    {
        public bool Equals(TrackedObject other)
        {
            return string.Equals(ownerId, other.ownerId) && string.Equals(objectId, other.objectId);
        }

        public override bool Equals(object obj)
        {
            if (ReferenceEquals(null, obj)) return false;
            return obj is TrackedObject && Equals((TrackedObject) obj);
        }

        public override int GetHashCode()
        {
            return objectId.GetHashCode();
        }

        public bool isActive;
        public Vector3 position;
        public Vector3 lookDirection;
        public string ownerId;
        public string prefab;
        public int objectId;

        public static bool operator ==(TrackedObject left, TrackedObject right)
        {
            return left.objectId == right.objectId;
        }

        public static bool operator !=(TrackedObject left, TrackedObject right)
        {
            return !(left == right);
        }
    }

    [Serializable]
    public struct InitialState
    {
        public string name;
        public object[] participants;
        public object state;
        public string id;
    }

    [Serializable]
    public struct TargetPlacementObject : IBufferable<TargetPlacement>
    {
        public TargetPlacementObject(TargetPlacement tPlacement)
        {
            id = tPlacement.Id;
            name = tPlacement.Name;
            position = tPlacement.Position.Value.ToUnityVector();
            isValid = true;
        }

        public TargetPlacementObject(TargetPlacementObject poiPlacementObject) : this()
        {
            id = poiPlacementObject.id;
            name = poiPlacementObject.name;
            position = poiPlacementObject.position;
            isValid = poiPlacementObject.isValid;
        }

        public int id;
        public string name;
        public Vector3 position;
        public bool isValid;

        public Offset<TargetPlacement> ToBuffer(FlatBufferBuilder builder)
        {
            var poiName = builder.CreateString(name);
            TargetPlacement.StartTargetPlacement(builder);
            TargetPlacement.AddId(builder, id);
            TargetPlacement.AddName(builder, poiName);
            TargetPlacement.AddPosition(builder, FlatBuffers.Vector3.CreateVector3(builder, position.x,
                position.y, position.z));
            return TargetPlacement.EndTargetPlacement(builder);
        }

        public static bool operator ==(TargetPlacementObject t1, TargetPlacementObject t2)
        {
            return t1.isValid == t2.isValid && t1.position == t2.position;
        }

        public static bool operator !=(TargetPlacementObject t1, TargetPlacementObject t2)
        {
            return !(t1 == t2);
        }
    }

    [Serializable]
    public struct AnnotationObject : IBufferable<Annotation>
    {
        public string userId;
        public string lineId;
        public Vector3[] positions;
        public bool isValid;

        public Offset<Annotation> ToBuffer(FlatBufferBuilder builder)
        {
            var annoLineId = builder.CreateString(lineId);
            var annoUserId = builder.CreateString(userId);
            Annotation.StartPositionsVector(builder, positions.Length);
            for (int i = positions.Length - 1; i >= 0; i--)
            {
                FlatBuffers.Vector3.CreateVector3(builder, positions[i].x,
                    positions[i].y, positions[i].z);
            }
            var poss = builder.EndVector();

            Annotation.StartAnnotation(builder);
            Annotation.AddLineId(builder, annoLineId);
            Annotation.AddUserId(builder, annoUserId);
            Annotation.AddPositions(builder, poss);
            return Annotation.EndAnnotation(builder);
        }

        public static implicit operator AnnotationObject(Annotation input)
        {
            var temp = new AnnotationObject
            {
                lineId = input.LineId,
                userId = input.UserId,
                positions = new Vector3[input.PositionsLength]
            };
            for (int i = 0; i < input.PositionsLength; i++)
            {
                temp.positions[i] = new Vector3(input.Positions(i).Value.X, input.Positions(i).Value.Y,
                    input.Positions(i).Value.Z);
            }
            temp.isValid = temp.positions.Length > 0;
            return temp;
        }
    }

    [Serializable]
    public struct ServerMessageObj
    {
        public string msgType;
        public string data;
    }

    [Serializable]
    public struct OnConnectedArgs
    {
        public string sid;
    }

    [Serializable]
    public struct CreatedEventArgs
    {
        public string name;
    }

    [Serializable]
    public struct UserLeftEventArgs
    {
        public string username;
    }

    [Serializable]
    public struct UserJoinedEventArgs
    {
        public string username;
    }

    [Serializable]
    public struct PropertiesChangedEventArgs
    {
        public string SiteDrive;
        public TargetPlacementObject poiPlacementObject;
        public List<AnnotationObject> annotationObjects;

        public static implicit operator PropertiesChangedEventArgs(StateUpdate sup)
        {
            var temp = new PropertiesChangedEventArgs();
            if (!string.IsNullOrEmpty(sup.SiteDrive))
            {
                temp.SiteDrive = sup.SiteDrive;
            }
            if (sup.AnnotationsLength > 0)
            {
                temp.annotationObjects = new List<AnnotationObject>();
                for (int i = 0; i < sup.AnnotationsLength; i++)
                {
                    if (!sup.Annotations(i).HasValue)
                    {
                        continue;
                    }
                    var anoObj = new AnnotationObject();
                    anoObj.lineId = sup.Annotations(i).Value.LineId;
                    anoObj.userId = sup.Annotations(i).Value.UserId;
                    anoObj.positions = new Vector3[sup.Annotations(i).Value.PositionsLength];
                    for (int j = 0; j < sup.Annotations(i).Value.PositionsLength; j++)
                    {
                        anoObj.positions[j] = new Vector3(sup.Annotations(i).Value.Positions(j).Value.X,
                            sup.Annotations(i).Value.Positions(j).Value.Y,
                            sup.Annotations(i).Value.Positions(j).Value.Z);
                    }
                    anoObj.isValid = true;
                    temp.annotationObjects.Add(anoObj);
                }
            }
            if (sup.Poi.HasValue)
            {
                temp.poiPlacementObject = new TargetPlacementObject
                {
                    id = sup.Poi.Value.Id,
                    name = sup.Poi.Value.Name,
                    position = new Vector3(sup.Poi.Value.Position.Value.X, sup.Poi.Value.Position.Value.Y,
                        sup.Poi.Value.Position.Value.Z),
                    isValid = true
                };
            }
            return temp;
        }
    }

    [Serializable]
    public struct ErrorMessageEventArgs
    {
        public string message;
    }

    /// <summary>
    /// This class facilitates the creation of server messages and isolates much of the flat buffer logic to a single place so that it is testable
    /// </summary>
    public static class ServerMessageFactoryFB
    {
        public static byte[] BuildMessage(msgType type, string stringData)
        {
            var fbb = new FlatBufferBuilder(1024);
            switch (type)
            {
                case msgType.SocketCreateOrJoinRoom:
                    var cjString = fbb.CreateString(stringData);
                    var cjRoomOffset = StringData.CreateStringData(fbb, cjString);
                    ServerMessage.StartServerMessage(fbb);
                    ServerMessage.AddType(fbb, msgType.SocketCreateOrJoinRoom);
                    ServerMessage.AddDataType(fbb, msg.StringData);
                    ServerMessage.AddData(fbb, cjRoomOffset.Value);
                    var builtMessage = ServerMessage.EndServerMessage(fbb);
                    fbb.Finish(builtMessage.Value);
                    return fbb.SizedByteArray();
            }
            return null;
        }

        public static byte[] BuildMessage(RoomStateGen state)
        {
            var sup = new StateUpdateObject();
            sup.siteDrive = state.siteDrive;
            return BuildMessage(sup);
        }

        public static byte[] BuildMessage(string roomName, string usrName, string usrId, string devType)
        {
            var fbb = new FlatBufferBuilder(1024);
            var rmNameOffset = fbb.CreateString(roomName);
            var usrNameOffset = fbb.CreateString(usrName);
            var usrIdOffset = fbb.CreateString(usrId);
            var devTypeOffset = fbb.CreateString(devType);
            var jcRoomOffset = JoinCreateRequest.CreateJoinCreateRequest(fbb,
                rmNameOffset, usrNameOffset, usrIdOffset, devTypeOffset);
            ServerMessage.StartServerMessage(fbb);
            ServerMessage.AddType(fbb, msgType.SocketCreateOrJoinRoom);
            ServerMessage.AddDataType(fbb, msg.JoinCreateRequest);
            ServerMessage.AddData(fbb, jcRoomOffset.Value);
            var builtMessage = ServerMessage.EndServerMessage(fbb);
            fbb.Finish(builtMessage.Value);
            return fbb.SizedByteArray();
        }

        public static byte[] BuildMessage(StateUpdateObject sup)
        {
            var fbb = new FlatBufferBuilder(1024);
            var supOffset = sup.ToBuffer(fbb);
            ServerMessage.StartServerMessage(fbb);
            ServerMessage.AddType(fbb, msgType.RoomStateUpdate);
            ServerMessage.AddDataType(fbb, msg.StateUpdate);
            ServerMessage.AddData(fbb, supOffset.Value);
            var builtMessage = ServerMessage.EndServerMessage(fbb);
            fbb.Finish(builtMessage.Value);
            return fbb.SizedByteArray();
        }

        public static byte[] BuildMessage()
        {
            var fbb = new FlatBufferBuilder(1024);
            ServerMessage.StartServerMessage(fbb);
            ServerMessage.AddType(fbb, msgType.SocketBlip);
            var builtMessage = ServerMessage.EndServerMessage(fbb);
            fbb.Finish(builtMessage.Value);
            return fbb.SizedByteArray();
        }
    }

    public static class ServerMessageFactory
    {
        public static string BuildMessage(string type, string stringData)
        {
            var sm = new ServerMessageObj
            {
                msgType = type,
                data = stringData
            };
            return JsonUtility.ToJson(sm);
        }
        
//        public static string BuildMessage(RoomStateGen state)
//        {
//        }
        
        public static string BuildMessage(string roomName, string usrName, string usrId, string devType)
        {
            var sm = new ServerMessageObj
            {
                msgType = "socket:createOrJoinRoom",
                data = JsonUtility.ToJson(new
                {
                    room = roomName,
                    username = usrName,
                    userId = usrId,
                    deviceType = devType,
                })
            };
            return JsonUtility.ToJson(sm);
        }
        
        public static string BuildMessage(StateUpdateObject sup)
        {
            var sm = new ServerMessageObj
            {
                msgType = "room:state:update",
                data = JsonUtility.ToJson(sup)
            };
            return JsonUtility.ToJson(sm);
        }

        public static string BuildMessage()
        {
            var sm = new ServerMessageObj
            {
                msgType = "socket:blip"
            };
            return JsonUtility.ToJson(sm);
        }
    }
}
