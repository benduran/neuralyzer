using System;
using System.Collections.Generic;
using FlatBuffers;
using Neuralyzer.Transport;
using UnityEngine;
using Neuralyzer.Transport.FlatBuffers;
using Vector3 = UnityEngine.Vector3;

namespace Assets.Neuralyzer.Scripts.Neuralyzer.Tests
{
  public class FBTypesTests : MonoBehaviour
  {
    public void Start()
    {
      TestPoi();
      TestRoomObject();
      TestAnnotation();
      TestStateUpdate();
      TestStringData();
      TestServerMessage();
    }

    private void TestAnnotation()
    {
      var TestAnnotation = new AnnotationObject
      {
        isValid = true,
        lineId = "testLine",
        positions = new []{Vector3.one},
        userId = "testUser"
      };
      var fbb = new FlatBufferBuilder(1024);
      var offset = TestAnnotation.ToBuffer(fbb);
      fbb.Finish(offset.Value);
      var bArray = fbb.SizedByteArray();
      var bb = new ByteBuffer(bArray);
      var desObj = Annotation.GetRootAsAnnotation(bb);
      print("Annotation Object Test : " + (CompareAnnotations(TestAnnotation, desObj) ? "Passed" : "Failed"));
    }

    private void TestRoomObject()
    {
      var TestObj = new RoomObjectObj
      {
        disposable = true,
        id = 27,
        isHidden = false,
        lookDirection = Vector3.forward,
        owner = "test",
        position = Vector3.one,
        prefab = "a test thing"
      };
      var fbb = new FlatBufferBuilder(1024);
      var offset = TestObj.ToBuffer(fbb);
      fbb.Finish(offset.Value);
      var bArray = fbb.SizedByteArray();
      var bb = new ByteBuffer(bArray);
      var desObj = RoomObject.GetRootAsRoomObject(bb);
      print("Room Object Test : " + (CompareRoomObjects(TestObj, desObj) ? "Passed" : "Failed"));
    }

    public void TestPoi()
    {
      TargetPlacementObject poi = new TargetPlacementObject
      {
        id = 0,
        isValid = true,
        name = "testPoi",
        position = Vector3.one
      };
      var fbb = new FlatBufferBuilder(1024);
      var offset = poi.ToBuffer(fbb);
      fbb.Finish(offset.Value);
      var bArray = fbb.SizedByteArray();
      var bb = new ByteBuffer(bArray);
      var desPoi = TargetPlacement.GetRootAsTargetPlacement(bb);
      print("Poi Test : " + (ComparePOI(poi, desPoi) ? "Passed" : "Failed"));
    }

    public void TestStateUpdate()
    {
      var sup = new StateUpdateObject();
      var created = new RoomObjectObj
      {
        disposable = true,
        id = 27,
        isHidden = false,
        lookDirection = Vector3.forward,
        owner = "test",
        position = Vector3.one,
        prefab = "a test thing"
      };
      var updated = new RoomObjectObj
      {
        disposable = false,
        id = 23,
        isHidden = true,
        lookDirection = Vector3.back,
        owner = "test",
        position = Vector3.down,
        prefab = ""
      };
      var deleted = 0;

      var TestAnnotation = new AnnotationObject
      {
        isValid = true,
        lineId = "testLine",
        positions = new[] { Vector3.one },
        userId = "testUser"
      };

      TargetPlacementObject poi = new TargetPlacementObject
      {
        id = 0,
        isValid = true,
        name = "testPoi",
        position = Vector3.one
      };

      var sitedrive = "SomeSiteDrive";

      var TestSUP = new StateUpdateObject
      {
        poiPlacementObject = poi,
        annotationObjects = new List<AnnotationObject>() { TestAnnotation},
        create = new List<RoomObjectObj>() { created},
        update = new List<RoomObjectObj>() { updated},
        delete = new List<int>() { deleted},
        siteDrive = sitedrive
      };

      var fbb = new FlatBufferBuilder(1024);
      var offset = TestSUP.ToBuffer(fbb);
      fbb.Finish(offset.Value);
      var bArray = fbb.SizedByteArray();
      var bb = new ByteBuffer(bArray);
      var desObj = StateUpdate.GetRootAsStateUpdate(bb);
      var passed = CompareStateUpdates(desObj, TestSUP);
     
      print("State Update : " + (passed ? "Passed" : "Failed"));
    }

    public void TestStringData()
    {
      var testString = "SomeTests";
      var fbb = new FlatBufferBuilder(1024);
      var tb = fbb.CreateString(testString);
      StringData.StartStringData(fbb);
      StringData.AddData(fbb,tb);
      var built = StringData.EndStringData(fbb);
      fbb.Finish(built.Value);
      var bArray = fbb.SizedByteArray();

      var bb = new ByteBuffer(bArray);
      var desData = StringData.GetRootAsStringData(bb);

      print("String Data : " + (desData.Data == testString ? "Passed" : "Failed"));
    }

    public void TestServerMessage()
    {
      print("String Data ServerMessage : " + (TestStringMessage()? "Passed" : "Failed"));
      print("State Update Server Message : " + (TestStateUpdateMessage() ? "Passed" : "Failed"));
    }

    private bool TestStringMessage()
    {
      var testString = "TestString";
      var buf = ServerMessageFactoryFB.BuildMessage(msgType.SocketCreateOrJoinRoom, testString);
      var bb = new ByteBuffer(buf);
      var desMsg = ServerMessage.GetRootAsServerMessage(bb);
      var passed = true;
      passed &= desMsg.DataType == msg.StringData;
      if (passed)
      {
        passed &= desMsg.Data<StringData>().Value.Data == testString;
      }
      return passed;
    }

    private bool TestStateUpdateMessage()
    {
      var sup = new StateUpdateObject();
      var created = new RoomObjectObj
      {
        disposable = true,
        id = 27,
        isHidden = false,
        lookDirection = Vector3.forward,
        owner = "test",
        position = Vector3.one,
        prefab = "a test thing"
      };
      var updated = new RoomObjectObj
      {
        disposable = false,
        id = 23,
        isHidden = true,
        lookDirection = Vector3.back,
        owner = "test",
        position = Vector3.down,
        prefab = ""
      };
      var deleted = 0;

      var TestAnnotation = new AnnotationObject
      {
        isValid = true,
        lineId = "testLine",
        positions = new[] { Vector3.one },
        userId = "testUser"
      };

      TargetPlacementObject poi = new TargetPlacementObject
      {
        id = 0,
        isValid = true,
        name = "testPoi",
        position = Vector3.one
      };

      var sitedrive = "SomeSiteDrive";

      var TestSUP = new StateUpdateObject
      {
        poiPlacementObject = poi,
        annotationObjects = new List<AnnotationObject>() { TestAnnotation },
        create = new List<RoomObjectObj>() { created },
        update = new List<RoomObjectObj>() { updated },
        delete = new List<int>() { deleted },
        siteDrive = sitedrive
      };

      var buf = ServerMessageFactoryFB.BuildMessage(TestSUP);
      var bb = new ByteBuffer(buf);
      var desMsg = ServerMessage.GetRootAsServerMessage(bb);
      var passed = true;
      passed &= desMsg.DataType == msg.StateUpdate;
      if (passed)
      {
        passed &= CompareStateUpdates(desMsg.Data<StateUpdate>().Value,TestSUP);
      }
      return passed;
    }

    private bool CompareStateUpdates(StateUpdate desObj, StateUpdateObject sup)
    {
      var passed = true;
      passed &= desObj.SiteDrive == sup.siteDrive;
      passed &= desObj.Delete(0) == sup.delete[0];
      passed &= desObj.Poi.Value.Id == sup.poiPlacementObject.id && desObj.Poi.Value.Name == sup.poiPlacementObject.name &&
                new Vector3(desObj.Poi.Value.Position.Value.X, desObj.Poi.Value.Position.Value.Y,
                  desObj.Poi.Value.Position.Value.Z) ==
                sup.poiPlacementObject.position;
      passed &= desObj.Create(0).Value.Id == sup.create[0].id && desObj.Create(0).Value.Owner == sup.create[0].owner &&
                new Vector3(desObj.Create(0).Value.Position.Value.X, desObj.Create(0).Value.Position.Value.Y,
                  desObj.Create(0).Value.Position.Value.Z) ==
                sup.create[0].position && new Vector3(desObj.Create(0).Value.LookDirection.Value.X,
                  desObj.Create(0).Value.LookDirection.Value.Y,
                  desObj.Create(0).Value.LookDirection.Value.Z) ==
                sup.create[0].lookDirection;

      passed &= desObj.Update(0).Value.Id == sup.update[0].id && desObj.Update(0).Value.Owner == sup.update[0].owner &&
                new Vector3(desObj.Update(0).Value.Position.Value.X, desObj.Update(0).Value.Position.Value.Y,
                  desObj.Update(0).Value.Position.Value.Z) ==
                sup.update[0].position && new Vector3(desObj.Update(0).Value.LookDirection.Value.X,
                  desObj.Update(0).Value.LookDirection.Value.Y,
                  desObj.Update(0).Value.LookDirection.Value.Z) ==
                sup.update[0].lookDirection;

      passed &= desObj.Annotations(0).Value.LineId == sup.annotationObjects[0].lineId && desObj.Annotations(0).Value.UserId == sup.annotationObjects[0].userId &&
                new Vector3(desObj.Annotations(0).Value.Positions(0).Value.X, desObj.Annotations(0).Value.Positions(0).Value.Y, desObj.Annotations(0).Value.Positions(0).Value.Z) ==
                sup.annotationObjects[0].positions[0];

      return passed;
    }

    private bool ComparePOI(TargetPlacementObject poi, TargetPlacement desPoi)
    {
      return desPoi.Id == poi.id && desPoi.Name == poi.name &&
             new Vector3(desPoi.Position.Value.X, desPoi.Position.Value.Y, desPoi.Position.Value.Z) ==
             poi.position;
    }

    private bool CompareRoomObjects(RoomObjectObj TestObj, RoomObject desObj)
    {
      return desObj.Id == TestObj.id && desObj.Owner == TestObj.owner &&
             new Vector3(desObj.Position.Value.X, desObj.Position.Value.Y, desObj.Position.Value.Z) ==
             TestObj.position && new Vector3(desObj.LookDirection.Value.X, desObj.LookDirection.Value.Y,
               desObj.LookDirection.Value.Z) ==
             TestObj.lookDirection;
    }

    private bool CompareAnnotations(AnnotationObject TestAnnotation, Annotation desObj)
    {
      return desObj.LineId == TestAnnotation.lineId && desObj.UserId == TestAnnotation.userId &&
             new Vector3(desObj.Positions(0).Value.X, desObj.Positions(0).Value.Y, desObj.Positions(0).Value.Z) ==
             Vector3.one;
    }
  }
}
